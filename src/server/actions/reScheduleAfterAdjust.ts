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

  // Determine which osmCategories will be re-scheduled by the given strategy.
  // CRITICAL: The DELETE in Step 3 must be scoped to ONLY these categories.
  // If strategy='ESG', we must NOT delete EE records -- they'd be lost forever.
  const osmCategoriesToReSchedule: string[] = [];
  if (!strategyParam || strategyParam === 'EE')  osmCategoriesToReSchedule.push('EE');
  if (!strategyParam || strategyParam === 'ESG') osmCategoriesToReSchedule.push('ESG');
  // Build a SQL IN literal (safe: values are hardcoded 'EE'/'ESG', not user input)
  const catInClause = osmCategoriesToReSchedule.map(c => `'${c}'`).join(', ');
  ctx.logger?.info?.(`[ReSchedule] Strategy: "${strategyParam || 'ALL'}", categories: ${catInClause}`);

  // ── 版本管理：runId 必填，所有操作均限定在此版本范围内 ─────────────────
  const runId: string = body.runId;
  if (!runId) {
    ctx.status = 400;
    ctx.body = { error: 'runId is required for reScheduleAfterAdjust' };
    return;
  }

  const ruleEngine = new RuleEngine(ctx);

  // ── 1. 读取锁定记录（isManualAdjusted=true）──────────────────────────
  ctx.logger?.info?.(`[ReSchedule] Step 1: Loading pinned results for runId=${runId}`);
  let pinnedResults: any[] = [];
  try {
    const [rows] = await ctx.db.sequelize.query(
      `SELECT id, "prodId", "itemId", "chosenLine", "startDate", "finishDate",
              "uph", "headcount", "dailyPlan", "adjustReason", "isManualAdjusted"
         FROM schedule_results_v2
        WHERE "isManualAdjusted" = true
          AND "runId" = :runId`,
      { replacements: { runId } },
    ) as any;
    pinnedResults = Array.isArray(rows) ? rows : [];
  } catch (e: any) {
    ctx.logger?.error?.('[ReSchedule] Load pinned failed: ' + (e?.message || e));
    pinnedResults = [];
  }


  const pinnedProdIds = new Set<string>(pinnedResults.map((r: any) => r.prodId).filter(Boolean));
  ctx.logger?.info?.(`[ReSchedule] Pinned records: ${pinnedResults.length} (prodIds: ${[...pinnedProdIds].join(', ')})`);

  // ── 2. 读取版本范围 prodId（必须在 DELETE 前，dryRun 也需要）────────────
  // 无论是否 dryRun，先拿到本版本所有 prodId，作为订单范围的唯一来源
  let scopeProdIds: string[] = [];
  let versionMinStart: string | undefined; // earliest startDate in this version (fallback for scheduleStartDate)
  try {
    const [scopeRows] = await ctx.db.sequelize.query(
      // Only read prodIds whose osmCategory matches the strategies being run.
      // This prevents re-scheduling orders of a different category
      // (e.g., EE orders when strategy='ESG').
      `SELECT DISTINCT "prodId" FROM schedule_results_v2
        WHERE "runId" = :runId
          AND "osmCategory" IN (${catInClause})`,
      { replacements: { runId } },
    ) as any;
    scopeProdIds = (scopeRows as any[]).map((r: any) => r.prodId).filter(Boolean);
    ctx.logger?.info?.(`[ReSchedule] Step 2: Version scope for runId=${runId} (categories=${catInClause}): ${scopeProdIds.length} prodIds`);

    // Also read the version's earliest startDate (within the same category scope)
    // so we can use it as a fallback when the caller did not supply body.startDate.
    const [minStartRows] = await ctx.db.sequelize.query(
      `SELECT MIN("startDate")::text AS "minStart" FROM schedule_results_v2
        WHERE "runId" = :runId
          AND "osmCategory" IN (${catInClause})`,
      { replacements: { runId } },
    ) as any;
    versionMinStart = (minStartRows as any[])[0]?.minStart ?? undefined;
    ctx.logger?.info?.(`[ReSchedule] Step 2: Version minStart=${versionMinStart ?? '(none)'}`);
  } catch (e: any) {
    ctx.logger?.error?.('[ReSchedule] Step 2: Scope query failed: ' + e?.message);
    ctx.status = 500;
    ctx.body = { error: 'Failed to read version scope: ' + e?.message };
    return;
  }

  if (scopeProdIds.length === 0) {
    ctx.logger?.warn?.(`[ReSchedule] runId=${runId} has no records, nothing to re-schedule`);
    ctx.body = { message: 'No records found for this version', runId };
    return;
  }

  // ── 3. 删除旧记录（仅删本版本 runId 内的非锁定记录）────────────────────
  if (!dryRun) {
    try {
      await ctx.db.sequelize.query(
        // IMPORTANT: only delete records whose category matches the strategies being run.
        // If strategy='ESG', EE records must NOT be deleted -- they cannot be re-inserted
        // by the ESG scheduler and would be permanently lost from the version.
        `DELETE FROM schedule_results_v2
          WHERE "runId" = :runId
            AND ("isManualAdjusted" = false OR "isManualAdjusted" IS NULL)
            AND "osmCategory" IN (${catInClause})`,
        { replacements: { runId } },
      );
      ctx.logger?.info?.(`[ReSchedule] Step 3: Deleted non-pinned (${catInClause}) results for runId=${runId}`);
    } catch (e: any) {
      ctx.logger?.error?.('[ReSchedule][ERROR] Delete non-pinned: ' + (e?.message || e));
      throw e;
    }
  }

  // ── 4. 拉取订单（严格限定在本版本 prodId 集合内，绝不引入新订单）──────
  // 非锁定 prodId = 版本范围 - 锁定的 prodId
  ctx.logger?.info?.('[ReSchedule] Step 4: Fetching orders strictly within version scope');
  const nonPinnedScopeIds = scopeProdIds.filter((id) => !pinnedProdIds.has(id));
  ctx.logger?.info?.(`[ReSchedule]   Non-pinned to re-schedule: ${nonPinnedScopeIds.length}/${scopeProdIds.length}`);

  // 若全部锁定（没有需要重排的订单），直接结束
  const allOrders = nonPinnedScopeIds.length > 0
    ? await step1_fetchOrders(ctx, nonPinnedScopeIds)
    : [];
  const nonPinnedOrders = allOrders.filter((o) => !pinnedProdIds.has(o.prodId));
  ctx.logger?.info?.(`[ReSchedule] Fetched from DB: ${allOrders.length}, filtered non-pinned: ${nonPinnedOrders.length}`);

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
      { lineLastFinish, lineLastItem },   // <- initialState: locked record line state
      body.startDate || versionMinStart || undefined,  // scheduleStartDate: explicit > version min > default(today)
    );

    allResults.push(...results);
    allExc.push(...schedEx);
    allLineUtil.push(...lineUtilization);
    ctx.logger?.info?.(`[ReSchedule]   Results: ${results.length}, Exceptions: ${schedEx.length}`);
  }

  // ── 6. 写入数据库（dryRun 时跳过）────────────────────────────────────
  // 版本管理：沿用传入的 runId，不生成新 runId

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

  // ── 7. UPDATE schedule_runs 统计（不新建记录，在原版本记录上更新）────────
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
        `UPDATE schedule_runs
            SET status             = :status,
                "scheduledCount"   = :scheduledCount,
                "exceptionCount"   = :exceptionCount,
                "successRate"      = :successRate,
                "lineUtilization"  = :lineUtilization::json,
                "exceptionBreakdown" = :exceptionBreakdown::json,
                "runTime"          = NOW()
          WHERE "runId" = :runId`,
        {
          replacements: {
            runId,
            status:             runStatus,
            scheduledCount:     allResults.length,
            exceptionCount:     allExc.length,
            successRate:        allResults.length > 0 ? 100 : 0,
            lineUtilization:    JSON.stringify(allLineUtil),
            exceptionBreakdown: JSON.stringify(exceptionBreakdown),
          },
        },
      );
      ctx.logger?.info?.(`[ReSchedule][DB] Updated schedule_runs for runId=${runId}`);
    } catch (e: any) {
      ctx.logger?.error?.('[ReSchedule][ERROR] Update schedule_runs: ' + (e?.original?.message || e?.message || e));
      // 不阻塞主流程
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
