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
 * 模式：全量覆盖——每次执行删除全部旧结果，写入完整新快照。
 * 每次运行都与一个唯一 runId 绑定，为将来版本历史功能预留扩展点。
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
import { fetchLlmDecisions, applyLlmOrdering } from './llmDecision';
import type { SchedulingDecision } from './llmDecision';

export async function runScheduling(ctx: Context) {
  const ruleEngine = new RuleEngine(ctx);
  const today = getTodayStr();

  // ── 1. 解析参数 ────────────────────────────────────────────────────
  const body = ctx.action?.params?.values ?? {};

  const strategyParam: string = (
    body.strategy || ctx.action?.params?.strategy || ''
  ).toUpperCase();

  // scope: 'current' → 仅重排 schedule_results_v2 中已有记录的订单
  // scope 不传（或其他值）→ 全量排产（从 ERP 源拉取所有订单）
  const scopeCurrent: boolean = (body.scope || '').toLowerCase() === 'current';

  // prodIds: 前端传入的选中订单列表；不传或空数组 = 全量排产
  let prodIds: string[] | undefined =
    Array.isArray(body.prodIds) && body.prodIds.length > 0
      ? body.prodIds
      : undefined;

  // startDate: 前端传入的排产开工日期（YYYY-MM-DD）；不传则退化为 getTodayStr()
  const startDateParam: string = body.startDate && /^\d{4}-\d{2}-\d{2}$/.test(body.startDate)
    ? body.startDate
    : getTodayStr();
  ctx.logger?.info?.(`[Init] startDate: ${startDateParam}`);

  // ── scope=current：从当前排产结果表获取产品 ID 范围 ────────────────
  if (scopeCurrent && !prodIds) {
    try {
      // 收集当次策略覆盖的产线
      const tmpStrategies: SchedulingStrategy[] = [];
      if (!strategyParam || strategyParam === 'EE')  tmpStrategies.push(new EEStrategy());
      if (!strategyParam || strategyParam === 'ESG') tmpStrategies.push(new ESGStrategy());
      const scopeLines = tmpStrategies.flatMap((s) => s.getFallbackLines());
      const scopeLineList = scopeLines.map((l) => `'${l}'`).join(', ');

      const [scopeRows] = await ctx.db.sequelize.query(
        `SELECT DISTINCT "prodId" FROM schedule_results_v2
          WHERE "chosenLine" IN (${scopeLineList})`,
      ) as any;
      prodIds = (scopeRows as any[]).map((r: any) => r.prodId).filter(Boolean);
      ctx.logger?.info?.(`[Init] scope=current: restricted to ${prodIds.length} prodIds from current results`);
    } catch (e: any) {
      ctx.logger?.warn?.('[Init] scope=current query failed, falling back to full fetch: ' + e?.message);
      prodIds = undefined;
    }
  }

  const runMode = prodIds ? (scopeCurrent ? 'CURRENT_RESULTS' : 'SELECTED') : 'FULL';

  const strategies: SchedulingStrategy[] = [];
  if (!strategyParam || strategyParam === 'EE')  strategies.push(new EEStrategy());
  if (!strategyParam || strategyParam === 'ESG') strategies.push(new ESGStrategy());

  ctx.logger?.info?.(`[Init] Strategies: ${strategies.map((s) => s.name).join(', ')} | Mode: ${runMode}${prodIds ? ` (${prodIds.length} orders)` : ''}`);

  // ── 2. 拉取订单（按 prodIds 过滤或全量）──────────────────────────
  const allOrders = await step1_fetchOrders(ctx, prodIds);
  ctx.logger?.info?.(`[Step 1] Loaded ${allOrders.length} orders`);

  const allResults: any[] = [];
  const allExc: any[] = [];
  const allLineUtil: any[] = [];

  // ── 2.5 预加载可排产订单池（一次性 DB 查询，后续全走内存 Set）────────
  ruleEngine.invalidateCache(); // 确保每次排产都读取最新配置
  const schedulablePoolSet = new Set<string>();
  for (const strategy of strategies) {
    const pools = await ruleEngine.getSchedulablePools(strategy.name);
    for (const p of pools) schedulablePoolSet.add(p.poolId);
  }
  ctx.logger?.info?.(`[Init] Schedulable pools: ${[...schedulablePoolSet].join(', ')}`);

  // ── 3a. 预检：找出不被任何策略覆盖的订单（如池子不在白名单），提前记录 WARNING ──
  // 这类订单会被 strategy.filterOrders() 静默过滤，用户无法从结果中得知原因。
  // 在此提前生成异常，让它们出现在排产历史和结果弹窗的异常明细里。
  {
    const handledIds = new Set<string>();
    for (const strategy of strategies) {
      for (const o of strategy.filterOrders(allOrders, schedulablePoolSet)) {
        handledIds.add(o.prodId);
      }
    }
    for (const o of allOrders) {
      if (!handledIds.has(o.prodId)) {
        allExc.push({
          prodId:        o.prodId,
          itemId:        o.itemId,
          exceptionType: 'POOL_NOT_SCHEDULABLE',
          severity:      'WARNING',
          message:       `生产池「${o.prodPoolId || '-'}」不在当前排产范围（仅支持装配类订单池），订单已跳过`,
        });
      }
    }
    if (allExc.length > 0) {
      ctx.logger?.info?.(`[Step pre] ${allExc.length} orders skipped (pool not schedulable)`);
    }
  }

  // ── 3. 逐策略执行排产 Pipeline ───────────────────────────────────
  let validCount = 0;
  for (const strategy of strategies) {
    ctx.logger?.info?.(`--- Strategy: ${strategy.name} ---`);

    // 按策略过滤订单
    const candidateOrders = strategy.filterOrders(allOrders, schedulablePoolSet);
    validCount += candidateOrders.length;
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

    // Step 5: 初始化产能池（使用前端指定的开工日期）
    const capacityPool = await step5_initCapacityPool(ctx, ruleEngine, lineCodes, startDateParam);

    // ── LLM 决策（可选）────────────────────────────────────────────────
    // 成功时：引导产线偏好 + 重排优先级；失败时：静默 fallback 到原算法
    let decisionMap: Map<string, SchedulingDecision> | undefined;
    const llmApiKey = process.env.OPENAI_API_KEY || '';
    console.log(llmApiKey, '---'); // 打印部分 key 以验证加载，但避免泄露完整值 
    const llmModel  = process.env.SCHEDULING_LLM_MODEL || 'gpt-4o-mini';

    if (llmApiKey) {
      // 构建产线映射摘要（客户 → 允许产线），供 LLM 参考
      const lineMapping: Record<string, string[]> = {};
      for (const o of sortedOrders) {
        const account = o.keyAccount || '';
        if (account && !lineMapping[account]) {
          const result = await ruleEngine.getCustomerLines(account);
          lineMapping[account] = result?.assignedLines || [];
        }
      }

      const rawDecisions = await fetchLlmDecisions(
        sortedOrders, lineMapping, today, llmApiKey, llmModel, ctx.logger,
      );
      console.log(rawDecisions, '--------------------------------------- LLM Decisions'); // 打印原始决策以供调试验证
      if (rawDecisions) {
        // 用 LLM 优先级重新排序订单
        sortedOrders = applyLlmOrdering(sortedOrders, rawDecisions);
        // 构建 Map 供 scheduleAll 逐条查用
        decisionMap = new Map(rawDecisions.map((d) => [d.prodId, d]));
        ctx.logger?.info?.(`[LLM] Mode: LLM_ASSISTED (${rawDecisions.length} decisions)`);
      } else {
        ctx.logger?.info?.('[LLM] Mode: ALGORITHM_ONLY (LLM returned null, using fallback)');
      }
    }

    // 核心排产（传入 startDateParam 使排产起算日与产能池一致，避免从 MOCK_TODAY 开工）
    const { results, exceptions: schedEx, lineUtilization } = await scheduleAll(
      sortedOrders, ruleEngine, lineCodes, capacityPool, ctx, strategy, decisionMap,
      undefined, // initialState（全量排产无锁定预占）
      startDateParam,
    );
    console.log(decisionMap,sortedOrders,'--------------------------------------- LLM Decision Map');
    console.log(results, schedEx, '--- Schedule All results and exceptions'); // 打印排产结果和异常以供调试验证
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

  // 版本管理：不删除旧数据，各版本按 runId 隔离共存。

  // 写入本次运行记录 —— 用 raw SQL 绕过 ORM 字段校验
  // 包含版本管理新字段：strategy / startDate / versionName
  const excSummary: Record<string, number> = {};
  for (const e of allExc) {
    const t = e.exceptionType || 'UNKNOWN';
    excSummary[t] = (excSummary[t] || 0) + 1;
  }
  const exceptionBreakdown = {
    summary: excSummary,
    details: allExc.map((e: any) => ({
      prodId:        e.prodId        || '',
      itemId:        e.itemId        || '',
      exceptionType: e.exceptionType || 'UNKNOWN',
      severity:      e.severity      || 'WARNING',
      message:       e.message       || '',
    })),
  };
  const runStatus = allExc.filter((e: any) => e.severity === 'BLOCKER').length === 0 ? 'SUCCESS' : 'PARTIAL';
  try {
    await ctx.db.sequelize.query(
      `INSERT INTO schedule_runs
        ("runId", "runTime", status, "totalOrders", "validOrders", "scheduledCount", "exceptionCount",
         "successRate", "lineUtilization", "exceptionBreakdown", "selectedProdIds", "runMode",
         strategy, "startDate", "versionName")
       VALUES (:runId, NOW(), :status, :totalOrders, :validOrders, :scheduledCount, :exceptionCount,
               :successRate, :lineUtilization::json, :exceptionBreakdown::json,
               :selectedProdIds::json, :runMode,
               :strategy, :startDate, '')`,
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
          selectedProdIds: prodIds ? JSON.stringify(prodIds) : null,
          runMode,
          strategy: strategyParam || 'ALL',
          startDate: startDateParam || '',
        },
      },
    );
    ctx.logger?.info?.('[DB] Inserted schedule_runs record');
  } catch (e: any) {
    ctx.logger?.error?.('[DB][ERROR] Insert schedule_runs: ' + (e?.original?.message || e?.message || String(e)));
    throw e;
  }

  // 写入排产结果 —— 用 raw SQL 确保字段与 DB 列严格对齐
  // console.info(allResults, allExc, '--- Total results and exceptions to insert----------------'); // 打印待插入记录数以供调试验证  
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
