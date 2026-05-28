/**
 * runScheduling.ts
 *
 * 排产引擎 HTTP 入口。
 *
 * 路由：
 *   POST /api/scheduling:run            ← 运行 EE + ESG 全量排产
 *   POST /api/scheduling:run?strategy=EE   ← 仅 EE
 *   POST /api/scheduling:run?strategy=ESG  ← 仅 ESG
 *
 * 本文件只负责：
 *   1. 解析策略参数，构建 strategy 列表
 *   2. 调用 pipeline（step1~step5 + scheduleAll）
 *   3. 将结果写入数据库（schedule_results_v2 / schedule_exceptions_v2 / schedule_runs）
 *   4. 返回 HTTP 响应
 *
 * 核心排产逻辑见 ./scheduling/ 子模块。
 */

import { Context } from '@nocobase/server';
import { RuleEngine } from '../engines';
import { EEStrategy, ESGStrategy, type SchedulingStrategy } from './strategies';
import {
  getTodayStr,
  step1_fetchOrders,
  step2_validateAndEnrich,
  step3_sort,
  step4_collectLines,
  step5_initCapacityPool,
  scheduleAll,
} from './scheduling';

export async function runScheduling(ctx: Context) {
  const ruleEngine = new RuleEngine(ctx);
  const today = getTodayStr();

  // ── 1. 解析策略参数 ──────────────────────────────────────────────
  const strategyParam: string = (
    ctx.action?.params?.values?.strategy || ctx.action?.params?.strategy || ''
  ).toUpperCase();

  const strategies: SchedulingStrategy[] = [];
  if (!strategyParam || strategyParam === 'EE') strategies.push(new EEStrategy());
  if (!strategyParam || strategyParam === 'ESG') strategies.push(new ESGStrategy());

  ctx.logger?.info?.(`[Init] Strategies: ${strategies.map((s) => s.name).join(', ')}`);

  // ── 2. 拉取全量订单（所有策略共用）────────────────────────────────
  const allOrders = await step1_fetchOrders(ctx);
  ctx.logger?.info?.(`[Step 1] Loaded ${allOrders.length} orders`);

  const allResults: any[] = [];
  const allExc: any[] = [];
  const allLineUtil: any[] = [];

  // ── 3. 逐策略执行排产 Pipeline ───────────────────────────────────
  for (const strategy of strategies) {  
    ctx.logger?.info?.(`--- Strategy: ${strategy.name} ---`);

    // 按策略过滤订单
    const candidateOrders = strategy.filterOrders(allOrders);
    ctx.logger?.info?.(`  Filtered: ${candidateOrders.length} orders`);

    // Step 2: 校验 & 富化
    const { validOrders, exceptions: valEx } = await step2_validateAndEnrich(candidateOrders, ctx);
    ctx.logger?.info?.(`  Valid: ${validOrders.length}, Exceptions: ${valEx.length}`);
    allExc.push(...valEx);
    if (validOrders.length === 0) continue;

    // Step 3: 排序（交期优先 + 聚类）；ESG 额外按客户聚类
    let sortedOrders = step3_sort(validOrders);
    if (strategy.beforeSchedule) {
      sortedOrders = strategy.beforeSchedule(sortedOrders);
    }

    // Step 4: 收集产线
    const lineCodes = await step4_collectLines(sortedOrders, ruleEngine, strategy);
    ctx.logger?.info?.(`  Lines: ${lineCodes.join(', ')}`);

    // Step 5: 初始化产能池
    const capacityPool = await step5_initCapacityPool(ctx, ruleEngine, lineCodes);

    // 核心排产
    const { results, exceptions: schedEx, lineUtilization } = await scheduleAll(
      sortedOrders, ruleEngine, lineCodes, capacityPool, ctx, strategy,
    );

    allResults.push(...results);
    allExc.push(...schedEx);
    allLineUtil.push(...lineUtilization);
    ctx.logger?.info?.(`  Results: ${results.length}, Exceptions: ${schedEx.length}`);
  }

  // ── 4. 写入数据库 ─────────────────────────────────────────────────
  const runId = `RUN_${Date.now()}`;
  const resultRepo = ctx.db.getRepository('schedule_results_v2');
  const excRepo = ctx.db.getRepository('schedule_exceptions_v2');
  const runRepo = ctx.db.getRepository('schedule_runs');

  // 清空旧数据
  const oldResults = await resultRepo.find({ fields: ['id'], paginate: false });
  if (oldResults.length > 0) {
    await resultRepo.destroy({ filterByTk: oldResults.map((r: any) => r.id) });
  }
  const oldExcs = await excRepo.find({ fields: ['id'], paginate: false });
  if (oldExcs.length > 0) {
    await excRepo.destroy({ filterByTk: oldExcs.map((r: any) => r.id) });
  }

  // 写入本次运行记录
  const exceptionBreakdown: Record<string, number> = {};
  for (const e of allExc) {
    const t = e.exceptionType || 'UNKNOWN';
    exceptionBreakdown[t] = (exceptionBreakdown[t] || 0) + 1;
  }
  await runRepo.create({
    values: {
      runId,
      runTime: new Date(),
      status: allExc.filter((e: any) => e.severity === 'BLOCKER').length === 0 ? 'SUCCESS' : 'PARTIAL',
      totalOrders: allOrders.length,
      validOrders: strategies.reduce((sum, s) => sum + s.filterOrders(allOrders).length, 0),
      scheduledCount: allResults.length,
      exceptionCount: allExc.length,
      successRate: allResults.length > 0 ? 100 : 0,
      lineUtilization: allLineUtil,
      exceptionBreakdown,
    },
  });

  if (allResults.length > 0) {
    await resultRepo.create({ values: allResults.map((r: any) => ({ ...r, runId })) });
  }
  if (allExc.length > 0) {
    await excRepo.create({ values: allExc.map((e: any) => ({ ...e, runId })) });
  }

  ctx.logger?.info?.(`[Done] ${allResults.length} results, ${allExc.length} exceptions`);

  // ── 5. HTTP 响应 ──────────────────────────────────────────────────
  ctx.body = {
    runId,
    strategies: strategies.map((s) => s.name),
    totalOrders: allOrders.length,
    scheduledCount: allResults.length,
    exceptionCount: allExc.length,
    exceptions: allExc,
    lineUtilization: allLineUtil,
  };
}
