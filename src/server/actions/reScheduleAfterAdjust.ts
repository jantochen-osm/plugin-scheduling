/**
 * reScheduleAfterAdjust.ts
 *
 * 调整后重计算 API
 *
 * 路由：POST /api/scheduling:reScheduleAfterAdjust
 *
 * 职责：
 *   1. 读取所有 isManualAdjusted=true 的"锁定记录"（用户已手工调整并固定）
 *   2. 删除所有 isManualAdjusted=false 的旧排产结果（方案 B：删除重插）
 *   3. 拉取全量订单，过滤掉锁定订单，仅对未锁定订单重新排产
 *   4. 初始化产能池后，调用 preOccupyPinnedResults 将锁定记录预占产能
 *   5. 以锁定记录产线状态为 initialState，调用 scheduleAll 重排未锁定订单
 *   6. 写入新结果 + schedule_runs（runType='READJUST'）
 *
 * 关键设计：
 *   - 锁定记录（isManualAdjusted=true）不被触碰，作为固定约束参与产能计算
 *   - 重算结果仅覆盖未锁定订单，用户手工调整结果始终保留
 *   - 复用全量排产的 Pipeline（step1~step5 + scheduleAll），保持逻辑一致性
 */

import type { Context } from '@nocobase/actions';
import { RuleEngine } from '../engines';
import { EEStrategy, ESGStrategy, type SchedulingStrategy } from './strategies';
import {
  step1_fetchOrders,
  step2_validateAndEnrich,
  step3_sort,
  step4_collectLines,
  step5_initCapacityPool,
  scheduleAll,
  preOccupyPinnedResults,
} from './scheduling';
import { fetchLlmDecisions, applyLlmOrdering } from './llmDecision';
import type { SchedulingDecision } from './llmDecision';


// ── 主 Action ────────────────────────────────────────────────────────────
export async function reScheduleAfterAdjust(ctx: Context) {
  const body = ctx.action?.params?.values ?? {};

  const strategyParam: string = (body.strategy || '').toUpperCase();
  const dryRun: boolean = body.dryRun === true;

  const ruleEngine = new RuleEngine(ctx);

  // ── 1. 读取锁定记录（isManualAdjusted=true）──────────────────────────
  ctx.logger?.info?.('[ReSchedule] Step 1: Loading pinned results');
  let pinnedResults: any[] = [];
  try {
    const [rows] = await ctx.db.sequelize.query(
      `SELECT id, "prodId", "itemId", "chosenLine", "startDate", "finishDate",
              "uph", "headcount", "dailyPlan", "adjustReason", "isManualAdjusted"
         FROM schedule_results_v2
        WHERE "isManualAdjusted" = true`,
    ) as any;
    // sequelize.query 返回 [rows, metadata]，rows 是结果数组
    pinnedResults = Array.isArray(rows) ? rows : [];
  } catch (e: any) {
    ctx.logger?.error?.('[ReSchedule] Load pinned failed: ' + (e?.message || e));
    // 若查询失败（如表不存在），继续但当作无锁定记录处理
    pinnedResults = [];
  }


  const pinnedProdIds = new Set<string>(pinnedResults.map((r: any) => r.prodId).filter(Boolean));
  ctx.logger?.info?.(`[ReSchedule] Pinned records: ${pinnedResults.length} (prodIds: ${[...pinnedProdIds].join(', ')})`);

  // ── 2. 删除旧记录（仅删当次策略覆盖产线的非锁定记录）────────────────────
  // ⚠️ 重要：必须先确定策略，再按产线范围删除，避免将其他策略（如EE）的结果清空
  // 策略确定逻辑与 step 4 保持一致
  const strategiesForDelete: SchedulingStrategy[] = [];
  if (!strategyParam || strategyParam === 'EE')  strategiesForDelete.push(new EEStrategy());
  if (!strategyParam || strategyParam === 'ESG') strategiesForDelete.push(new ESGStrategy());

  // 收集所有待删产线（各策略 fallbackLines 的并集）
  const linesToDelete = new Set<string>();
  for (const s of strategiesForDelete) {
    s.getFallbackLines().forEach((l) => linesToDelete.add(l));
  }

  if (!dryRun && linesToDelete.size > 0) {
    // ── 2a. 先记录当前产线范围内的所有产品 ID（DELETE 前读取）──────────
    // 必须在 DELETE 之前执行，因为 DELETE 会删掉非锁定记录
    const scopeLineList = [...linesToDelete].map((l) => `'${l}'`).join(', ');
    let currentScopeProdIds: string[] | undefined;
    try {
      const [scopeRows] = await ctx.db.sequelize.query(
        `SELECT DISTINCT "prodId" FROM schedule_results_v2
          WHERE "chosenLine" IN (${scopeLineList})`,
      ) as any;
      currentScopeProdIds = (scopeRows as any[]).map((r: any) => r.prodId).filter(Boolean);
      ctx.logger?.info?.(`[ReSchedule] Step 2a: Current scope prodIds: ${currentScopeProdIds.length}`);
      // 挂到函数级变量，Step 3 复用
      (reScheduleAfterAdjust as any)._currentScopeProdIds = currentScopeProdIds;
    } catch (e: any) {
      ctx.logger?.warn?.('[ReSchedule] Step 2a: Scope query failed, will fall back to full fetch. ' + e?.message);
      (reScheduleAfterAdjust as any)._currentScopeProdIds = undefined;
    }

    // 构建 IN 子句
    const lineList = scopeLineList;
    try {
      await ctx.db.sequelize.query(
        `DELETE FROM schedule_results_v2
          WHERE ("isManualAdjusted" = false OR "isManualAdjusted" IS NULL)
            AND "chosenLine" IN (${lineList})`,
      );
      ctx.logger?.info?.(`[ReSchedule] Step 2: Deleted non-pinned results for lines: ${[...linesToDelete].join(', ')}`);
    } catch (e: any) {
      ctx.logger?.error?.('[ReSchedule][ERROR] Delete non-pinned: ' + (e?.message || e));
      throw e;
    }
  }

  // ── 3. 拉取订单（仅限 Step 2a 记录的当前排产存量）──────────────────
  // _currentScopeProdIds 由 Step 2a 在 DELETE 前读取（含锁定+非锁定），
  // undefined 表示结果表为空或查询失败，退化为全量拉取
  ctx.logger?.info?.('[ReSchedule] Step 3: Fetching orders for current scope');
  const currentScopeProdIds: string[] | undefined =
    (reScheduleAfterAdjust as any)._currentScopeProdIds;

  const allOrders = await step1_fetchOrders(ctx, currentScopeProdIds);
  const nonPinnedOrders = allOrders.filter((o) => !pinnedProdIds.has(o.prodId));
  ctx.logger?.info?.(`[ReSchedule] Total fetched: ${allOrders.length}, non-pinned to re-schedule: ${nonPinnedOrders.length}`);

  const allResults: any[] = [];
  const allExc: any[] = [];
  const allLineUtil: any[] = [];

  // ── 4. 确定策略 ───────────────────────────────────────────────────────
  const strategies: SchedulingStrategy[] = [];
  if (!strategyParam || strategyParam === 'EE')  strategies.push(new EEStrategy());
  if (!strategyParam || strategyParam === 'ESG') strategies.push(new ESGStrategy());

  // ── 5. 逐策略执行 Pipeline + 预占 + 重排 ─────────────────────────────
  for (const strategy of strategies) {
    ctx.logger?.info?.(`[ReSchedule] --- Strategy: ${strategy.name} ---`);

    // 按策略过滤（EE/ESG 各有不同的 filterOrders 规则）
    const candidateOrders = strategy.filterOrders(nonPinnedOrders);
    ctx.logger?.info?.(`[ReSchedule]   Filtered non-pinned: ${candidateOrders.length}`);
    if (candidateOrders.length === 0) continue;

    // Step 2: 校验 & 富化
    const { validOrders, exceptions: valEx } = await step2_validateAndEnrich(candidateOrders, ctx);
    ctx.logger?.info?.(`[ReSchedule]   Valid: ${validOrders.length}, Exceptions: ${valEx.length}`);
    allExc.push(...valEx);
    if (validOrders.length === 0) continue;

    // Step 3: 排序
    let sortedOrders = step3_sort(validOrders);
    if (strategy.beforeSchedule) {
      sortedOrders = strategy.beforeSchedule(sortedOrders);
    }

    // Step 4: 收集产线
    const lineCodes = await step4_collectLines(sortedOrders, ruleEngine, strategy);
    ctx.logger?.info?.(`[ReSchedule]   Lines: ${lineCodes.join(', ')}`);

    // Step 5: 初始化产能池（空池，从日历数据出发）
    const capacityPool = await step5_initCapacityPool(ctx, ruleEngine, lineCodes);

    // ── 预占锁定记录的产能（核心）──────────────────────────────────────
    // 将 isManualAdjusted=true 的记录预先 allocate 到 capacityPool，
    // 并收集 lineLastFinish / lineLastItem 供 scheduleAll 顺序约束感知
    const lineLastFinish: Record<string, string> = {};
    const lineLastItem: Record<string, string> = {};

    // 仅预占与当前策略产线有关的锁定记录（避免跨策略污染）
    const strategyLineSet = new Set(lineCodes);
    const relevantPinned = pinnedResults.filter((r: any) =>
      r.chosenLine && strategyLineSet.has(r.chosenLine),
    );

    if (relevantPinned.length > 0) {
      preOccupyPinnedResults(relevantPinned, capacityPool, lineLastFinish, lineLastItem);
      // 打印被跳过的历史日期锁定记录（finishDate < today，不参与预占）
      const skipped = (preOccupyPinnedResults as any)._lastSkipped;
      if (skipped?.length) {
        ctx.logger?.warn?.(
          `[ReSchedule]   ⚠️ Skipped ${skipped.length} historical pinned record(s) (finishDate < today): ` +
          skipped.join(', '),
        );
      }
      ctx.logger?.info?.(
        `[ReSchedule]   Pre-occupied ${relevantPinned.length} pinned records. ` +
        `lineLastFinish: ${JSON.stringify(lineLastFinish)}`,
      );
    }

    // ── LLM 决策（可选，复用全量排产逻辑）────────────────────────────
    let decisionMap: Map<string, SchedulingDecision> | undefined;
    const llmApiKey = process.env.OPENAI_API_KEY || '';
    const llmModel  = process.env.SCHEDULING_LLM_MODEL || 'gpt-4o-mini';

    if (llmApiKey) {
      const lineMapping: Record<string, string[]> = {};
      for (const o of sortedOrders) {
        const account = o.keyAccount || '';
        if (account && !lineMapping[account]) {
          const result = await ruleEngine.getCustomerLines(account);
          lineMapping[account] = result?.assignedLines || [];
        }
      }
      const rawDecisions = await fetchLlmDecisions(
        sortedOrders, lineMapping, new Date().toISOString().split('T')[0],
        llmApiKey, llmModel, ctx.logger,
      );
      if (rawDecisions) {
        sortedOrders = applyLlmOrdering(sortedOrders, rawDecisions);
        decisionMap = new Map(rawDecisions.map((d) => [d.prodId, d]));
      }
    }

    // ── 核心重排（传入 initialState，感知锁定记录的产线约束）──────────
    const { results, exceptions: schedEx, lineUtilization } = await scheduleAll(
      sortedOrders,
      ruleEngine,
      lineCodes,
      capacityPool,
      ctx,
      strategy,
      decisionMap,
      { lineLastFinish, lineLastItem },   // ← initialState：锁定记录产线状态
    );

    allResults.push(...results);
    allExc.push(...schedEx);
    allLineUtil.push(...lineUtilization);
    ctx.logger?.info?.(`[ReSchedule]   Results: ${results.length}, Exceptions: ${schedEx.length}`);
  }

  // ── 6. 写入数据库（dryRun 时跳过）────────────────────────────────────
  const runId = `READJ_${Date.now()}`;

  if (!dryRun && allResults.length > 0) {
    try {
      for (const r of allResults) {
        await ctx.db.sequelize.query(
          `INSERT INTO schedule_results_v2
            ("runId", "prodId", "itemId", "totalQty", "dlvDate", "prodStatus", "prodPoolId", "osmCategory",
             "startDate", "finishDate", "isOverdue", "overdueDays", "overdueType",
             "candidateLines", "chosenLine", uph, headcount, "dailyPlan", "dailyPlanDetail",
             "isManualAdjusted", "pinnedBy")
           VALUES
            (:runId, :prodId, :itemId, :totalQty, :dlvDate::date, :prodStatus, :prodPoolId, :osmCategory,
             :startDate::date, :finishDate::date, :isOverdue, :overdueDays, :overdueType,
             :candidateLines, :chosenLine, :uph, :headcount, :dailyPlan::json, :dailyPlanDetail::json,
             false, NULL)`,
          {
            replacements: {
              runId,
              prodId:          r.prodId          ?? null,
              itemId:          r.itemId          ?? null,
              totalQty:        r.totalQty        ?? null,
              dlvDate:         r.dlvDate         ?? null,
              prodStatus:      r.prodStatus      ?? null,
              prodPoolId:      r.prodPoolId      ?? null,
              osmCategory:     r.osmCategory     ?? null,
              startDate:       r.startDate       ?? null,
              finishDate:      r.finishDate      ?? null,
              isOverdue:       r.isOverdue       ?? false,
              overdueDays:     r.overdueDays     ?? 0,
              overdueType:     r.overdueType     ?? null,
              candidateLines:  r.candidateLines  ?? null,
              chosenLine:      r.chosenLine      ?? null,
              uph:             r.uph             ?? null,
              headcount:       r.headcount       ?? null,
              dailyPlan:       JSON.stringify(r.dailyPlan     ?? {}),
              dailyPlanDetail: JSON.stringify(r.dailyPlanDetail ?? {}),
            },
          },
        );
      }
      ctx.logger?.info?.(`[ReSchedule][DB] Inserted ${allResults.length} new results`);
    } catch (e: any) {
      ctx.logger?.error?.('[ReSchedule][ERROR] Insert results: ' + (e?.original?.message || e?.message || e));
      throw e;
    }
  }

  // ── 7. 写入 schedule_runs（runType='READJUST'）────────────────────────
  if (!dryRun) {
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
    const runStatus = allExc.filter((e: any) => e.severity === 'BLOCKER').length === 0
      ? 'SUCCESS' : 'PARTIAL';

    try {
      await ctx.db.sequelize.query(
        `INSERT INTO schedule_runs
          ("runId", "runTime", status, "totalOrders", "validOrders", "scheduledCount", "exceptionCount",
           "successRate", "lineUtilization", "exceptionBreakdown", "selectedProdIds", "runMode",
           "runType", "pinnedCount", "reScheduledCount")
         VALUES
          (:runId, NOW(), :status, :totalOrders, :validOrders, :scheduledCount, :exceptionCount,
           :successRate, :lineUtilization::json, :exceptionBreakdown::json,
           NULL, 'READJUST',
           'READJUST', :pinnedCount, :reScheduledCount)`,
        {
          replacements: {
            runId,
            status:              runStatus,
            totalOrders:         allOrders.length,
            validOrders:         nonPinnedOrders.length,
            scheduledCount:      allResults.length,
            exceptionCount:      allExc.length,
            successRate:         allResults.length > 0 ? 100 : 0,
            lineUtilization:     JSON.stringify(allLineUtil),
            exceptionBreakdown:  JSON.stringify(exceptionBreakdown),
            pinnedCount:         pinnedResults.length,
            reScheduledCount:    allResults.length,
          },
        },
      );
      ctx.logger?.info?.('[ReSchedule][DB] Inserted schedule_runs record');
    } catch (e: any) {
      ctx.logger?.error?.('[ReSchedule][ERROR] Insert schedule_runs: ' + (e?.original?.message || e?.message || e));
      // schedule_runs 写入失败不阻塞主流程，仅记录错误
    }
  }

  // ── 8. HTTP 响应 ──────────────────────────────────────────────────────
  let globalStartDate = '';
  let globalEndDate   = '';
  if (allResults.length > 0) {
    const starts = allResults.map((r: any) => r.startDate).filter(Boolean).sort();
    const ends   = allResults.map((r: any) => r.finishDate).filter(Boolean).sort();
    globalStartDate = starts[0] || '';
    globalEndDate   = ends[ends.length - 1] || '';
  }

  ctx.body = {
    runId,
    runType:          'READJUST',
    pinnedCount:      pinnedResults.length,
    reScheduledCount: allResults.length,
    dryRun,
    strategies:       strategies.map((s) => s.name),
    globalStartDate,
    globalEndDate,
    exceptionCount:   allExc.length,
    exceptions:       allExc,
    lineUtilization:  allLineUtil,
  };

  ctx.logger?.info?.(
    `[ReSchedule][Done] pinned=${pinnedResults.length}, reScheduled=${allResults.length}, exceptions=${allExc.length}`,
  );
}
