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

import type { Context } from '@nocobase/actions';
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

  // ── 4. 计算全局日期范围（仅用于 HTTP 响应，不写入 DB）────────────────
  let globalStartDate = '';
  let globalEndDate = '';
  if (allResults.length > 0) {
    const starts = allResults.map((r: any) => r.startDate).filter(Boolean).sort();
    const ends   = allResults.map((r: any) => r.finishDate).filter(Boolean).sort();
    globalStartDate = starts[0] || '';
    globalEndDate   = ends[ends.length - 1] || '';
  }

  // ── 5. 写入数据库 ─────────────────────────────────────────────────
  const runId = `RUN_${Date.now()}`;
  const resultRepo = ctx.db.getRepository('schedule_results_v2');
  const excRepo = ctx.db.getRepository('schedule_exceptions_v2');
  const runRepo = ctx.db.getRepository('schedule_runs');

  // 清空旧数据
  try {
    const oldResults = await resultRepo.find({ fields: ['id'], paginate: false });
    if (oldResults.length > 0) await resultRepo.destroy({ filterByTk: oldResults.map((r: any) => r.id) });
    ctx.logger?.info?.('[DB] Cleared old results');
  } catch (e: any) {
    ctx.logger?.error?.('[DB][ERROR] Clear results_v2: ' + (e?.original?.message || e?.message || e));
    throw e;
  }
  try {
    const oldExcs = await excRepo.find({ fields: ['id'], paginate: false });
    if (oldExcs.length > 0) await excRepo.destroy({ filterByTk: oldExcs.map((r: any) => r.id) });
    ctx.logger?.info?.('[DB] Cleared old exceptions');
  } catch (e: any) {
    ctx.logger?.error?.('[DB][ERROR] Clear exceptions_v2: ' + (e?.original?.message || e?.message || e));
    throw e;
  }

  // 写入本次运行记录 —— 用 raw SQL 绕过 ORM 字段校验
  const exceptionBreakdown: Record<string, number> = {};
  for (const e of allExc) {
    const t = e.exceptionType || 'UNKNOWN';
    exceptionBreakdown[t] = (exceptionBreakdown[t] || 0) + 1;
  }
  const runStatus = allExc.filter((e: any) => e.severity === 'BLOCKER').length === 0 ? 'SUCCESS' : 'PARTIAL';
  const validCount = strategies.reduce((sum, s) => sum + s.filterOrders(allOrders).length, 0);
  try {
    await ctx.db.sequelize.query(
      `INSERT INTO schedule_runs
        ("runId", "runTime", status, "totalOrders", "validOrders", "scheduledCount", "exceptionCount", "successRate", "lineUtilization", "exceptionBreakdown")
       VALUES (:runId, NOW(), :status, :totalOrders, :validOrders, :scheduledCount, :exceptionCount, :successRate, :lineUtilization::json, :exceptionBreakdown::json)`,
      {
        replacements: {
          runId,
          status: runStatus,
          totalOrders: allOrders.length,
          validOrders: validCount,
          scheduledCount: allResults.length,
          exceptionCount: allExc.length,
          successRate: allResults.length > 0 ? 100 : 0,
          lineUtilization: JSON.stringify(allLineUtil),
          exceptionBreakdown: JSON.stringify(exceptionBreakdown),
        },
      },
    );
    ctx.logger?.info?.('[DB] Inserted schedule_runs record via raw SQL');
  } catch (e: any) {
    ctx.logger?.error?.('[DB][ERROR] Insert schedule_runs: ' + (e?.original?.message || e?.message || String(e)));
    throw e;
  }

  // 写入排产结果 —— 用 raw SQL 确保字段与 DB 列严格对齐
  if (allResults.length > 0) {
    try {
      // 构建批量 INSERT values
      const rows = allResults.map((r: any) => ({
        runId,
        prodId:         r.prodId         ?? null,
        itemId:         r.itemId         ?? null,
        totalQty:       r.totalQty       ?? null,
        dlvDate:        r.dlvDate        ?? null,
        prodStatus:     r.prodStatus     ?? null,
        prodPoolId:     r.prodPoolId     ?? null,
        osmCategory:    r.osmCategory    ?? null,
        startDate:      r.startDate      ?? null,
        finishDate:     r.finishDate     ?? null,
        isOverdue:      r.isOverdue      ?? false,
        overdueDays:    r.overdueDays    ?? 0,
        overdueType:    r.overdueType    ?? null,
        candidateLines: r.candidateLines ?? null,
        chosenLine:     r.chosenLine     ?? null,
        uph:            r.uph            ?? null,
        headcount:      r.headcount      ?? null,
        dailyPlan:      JSON.stringify(r.dailyPlan    ?? {}),
        dailyPlanDetail:JSON.stringify(r.dailyPlanDetail ?? {}),
      }));

      for (const row of rows) {
        await ctx.db.sequelize.query(
          `INSERT INTO schedule_results_v2
            ("runId", "prodId", "itemId", "totalQty", "dlvDate", "prodStatus", "prodPoolId", "osmCategory",
             "startDate", "finishDate", "isOverdue", "overdueDays", "overdueType",
             "candidateLines", "chosenLine", uph, headcount, "dailyPlan", "dailyPlanDetail")
           VALUES
            (:runId, :prodId, :itemId, :totalQty, :dlvDate::date, :prodStatus, :prodPoolId, :osmCategory,
             :startDate::date, :finishDate::date, :isOverdue, :overdueDays, :overdueType,
             :candidateLines, :chosenLine, :uph, :headcount, :dailyPlan::json, :dailyPlanDetail::json)`,
          { replacements: row },
        );
      }
      ctx.logger?.info?.('[DB] Inserted ' + allResults.length + ' results via raw SQL');
    } catch (e: any) {
      ctx.logger?.error?.('[DB][ERROR] Insert schedule_results_v2: ' + (e?.original?.message || e?.message || String(e)));
      throw e;
    }
  }

  if (allExc.length > 0) {
    try {
      await excRepo.create({ values: allExc.map((e: any) => ({ ...e, runId })) });
      ctx.logger?.info?.('[DB] Inserted ' + allExc.length + ' exceptions');
    } catch (e: any) {
      ctx.logger?.error?.('[DB][ERROR] Insert exceptions_v2: ' + (e?.original?.message || e?.message || String(e)));
      throw e;
    }
  }

  ctx.logger?.info?.(`[Done] ${allResults.length} results, ${allExc.length} exceptions`);

  // ── 6. HTTP 响应 ──────────────────────────────────────────────────
  ctx.body = {
    runId,
    strategies: strategies.map((s) => s.name),
    totalOrders: allOrders.length,
    scheduledCount: allResults.length,
    exceptionCount: allExc.length,
    globalStartDate,
    globalEndDate,
    exceptions: allExc,
    lineUtilization: allLineUtil,
  };
}
