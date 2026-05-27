/**
 * scheduling/scheduleAll.ts
 *
 * 核心排产循环。
 *
 * 对每一个订单，依次执行：
 *   1. 获取允许产线（customer_line_mapping → fallbackLines）
 *   2. 查询 UPH（dn_operrouteline）
 *   3. 对候选产线评分排名（产能 / 换型亲和 / 负载均衡）
 *   4. 枚举 [不加班→加班] × [单线→多线] 的组合，用 calcLatestStart +
 *      tryScheduleStage 找到最优方案（bestResult）
 *   5. 提交 bestResult，更新产能池 & lineLastFinish 顺序约束
 */

import { Context } from '@nocobase/server';
import { RuleEngine, CapacityPool, StageDependencyManager } from '../../engines';
import type { SchedulingStrategy } from '../strategies';
import { addDays, formatDate, getTodayStr, SCHEDULING_CONFIG } from './config';
import { calcLatestStart } from './calcLatestStart';
import { getCombinations, tryScheduleStage } from './tryScheduleStage';

// ── 产线评分 ─────────────────────────────────────────────────────────
/**
 * 对候选产线按三个维度评分并排名：
 *   - capScore:       窗口期内剩余产能 / 所需工时（≥1 saturated to 1）
 *   - affinityScore:  上一单同品号则为 1（减少换型）
 *   - loadScore:      当前负载越轻得分越高
 */
function rankCandidateLines(
  allowedLines: string[],
  lineCodes: string[],
  lineLoad: Record<string, number>,
  lineLastItem: Record<string, string>,
  capacityPool: CapacityPool,
  mo: any,
  uph: number,
  earliestStart: string,
  targetDlv: string,
  weights: { capacity: number; setupAffinity: number; loadBalance: number },
): string[] {
  const maxLoad = Math.max(...lineCodes.map((l) => lineLoad[l] || 0), 1);
  const neededHours = uph > 0 ? mo.qtySched / uph : 1;

  return allowedLines
    .filter((l) => lineCodes.includes(l))
    .map((line) => {
      // 窗口期产能
      let windowCap = 0;
      for (let d = new Date(earliestStart), dEnd = new Date(targetDlv); d <= dEnd; d.setDate(d.getDate() + 1)) {
        windowCap += capacityPool.getAvailableHours(line, formatDate(d));
      }
      const capScore = Math.min(windowCap / neededHours, 1.0);
      const affinityScore = lineLastItem[line] === mo.itemId ? 1 : 0;
      const loadScore = 1 - (lineLoad[line] || 0) / maxLoad;
      const score = weights.capacity * capScore + weights.setupAffinity * affinityScore + weights.loadBalance * loadScore;
      return { line, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.line);
}

// ── 提交最优方案 ─────────────────────────────────────────────────────
/**
 * 将 bestResult 写入产能池，记录排产结果，更新产线状态。
 * 返回本次提交的 result 记录数组（一个产线一条）。
 */
function commitBestResult(
  mo: any,
  bestResult: any,
  allowedLines: string[],
  stageName: string,
  uph: number,
  headcount: number,
  dlvStr: string,
  today: string,
  lineLastItem: Record<string, string>,
  lineLoad: Record<string, number>,
  lineLastFinish: Record<string, string>,
  capacityPool: CapacityPool,
  cfg: ReturnType<SchedulingStrategy['getConfig']>,
): any[] {
  const committed: any[] = [];

  for (const line of bestResult.linesUsed) {
    const dp = bestResult.dailyPlans[line] || {};
    const ep = bestResult.extraPlans[line] || {};
    const sortedDates = Object.keys(dp).sort();

    // 尾单合并：末日产量低于 minTailQty 时并入前一天，减少换线频率
    for (let i = sortedDates.length - 1; i >= 1; i--) {
      if (dp[sortedDates[i]] < SCHEDULING_CONFIG.minTailQty && dp[sortedDates[i]] < dp[sortedDates[i - 1]]) {
        dp[sortedDates[i - 1]] += dp[sortedDates[i]];
        delete dp[sortedDates[i]];
        if (ep[sortedDates[i]]) delete ep[sortedDates[i]];
      }
    }

    const lineSetupHours = lineLastItem[line] !== mo.itemId ? cfg.setupTimeHours : 0;
    let isFirstDay = true;
    let lineStart = '';
    let lineFinish = '';
    let lineQty = 0;

    // 正式分配产能（tryScheduleStage 已 rollback，此处重新 allocate）
    for (const dateStr of Object.keys(dp).sort()) {
      const qty = dp[dateStr];
      const setupH = isFirstDay ? lineSetupHours : 0;
      isFirstDay = false;
      const extraQty = ep[dateStr] || 0;
      const standardQty = Math.max(0, qty - extraQty);
      const totalH = setupH + standardQty / uph;
      capacityPool.allocate(line, dateStr, Math.min(totalH, capacityPool.getAvailableHours(line, dateStr) + (setupH || 0)));
      lineQty += qty;
      if (!lineStart || dateStr < lineStart) lineStart = dateStr;
      if (!lineFinish || dateStr > lineFinish) lineFinish = dateStr;
    }

    // 更新产线状态
    lineLastItem[line] = mo.itemId;
    lineLoad[line] = (lineLoad[line] || 0) + lineQty / uph + lineSetupHours;
    // 顺序约束：记录本单完成日期，下一单必须在此之后才能开始
    if (lineFinish && (!lineLastFinish[line] || lineFinish > lineLastFinish[line])) {
      lineLastFinish[line] = lineFinish;
    }

    // Guard：跳过空结果
    if (lineQty <= 0 || !lineStart || !lineFinish || lineStart === 'Invalid date') continue;

    const overdueDays = lineFinish > dlvStr
      ? Math.ceil((new Date(lineFinish).getTime() - new Date(dlvStr).getTime()) / 86400000)
      : 0;
    const overdueType = dlvStr < today ? 'PAST_DUE' : overdueDays > 0 ? 'AT_RISK' : 'ON_TIME';

    committed.push({
      prodId: mo.prodId, itemId: mo.itemId, totalQty: lineQty,
      dlvDate: dlvStr, prodStatus: mo.prodStatus, prodPoolId: mo.prodPoolId, osmCategory: mo.osmCategory,
      startDate: lineStart, finishDate: lineFinish, isOverdue: overdueDays > 0,
      overdueDays, overdueType,
      candidateLines: allowedLines.join(','), chosenLine: line,
      uph, headcount, dailyPlan: dp,
      extraCapacityPlan: Object.keys(ep).length > 0 ? ep : null,
      setupTimeUsed: lineSetupHours,
      costEstimate: bestResult.costEstimate,
      stage: stageName,
    });
  }

  return committed;
}

// ── 主循环 ──────────────────────────────────────────────────────────
export async function scheduleAll(
  sortedOrders: any[],
  ruleEngine: RuleEngine,
  lineCodes: string[],
  capacityPool: CapacityPool,
  ctx: Context,
  strategy: SchedulingStrategy,
) {
  const results: any[] = [];
  const exceptions: any[] = [];
  const sdm = new StageDependencyManager();
  const today = getTodayStr();
  const cfg = strategy.getConfig();

  // 从所有订单的 _stages 收集真实 stageSequence，注册到 SDM
  const stageDefMap = new Map<string, number>();
  for (const o of sortedOrders) {
    for (const s of (o._stages || [])) {
      if (!stageDefMap.has(s.stageName)) {
        stageDefMap.set(s.stageName, (s as any).stageSequence ?? 99);
      }
    }
  }
  sdm.registerStages(
    [...stageDefMap.entries()].map(([stageName, stageSequence]) => ({ stageName, stageSequence })),
  );

  // 产线状态追踪
  const lineLoad: Record<string, number> = {};
  const lineLastItem: Record<string, string> = {};
  /** 顺序约束：记录每条产线最后一个已提交订单的完成日期 */
  const lineLastFinish: Record<string, string> = {};
  for (const l of lineCodes) { lineLoad[l] = 0; lineLastItem[l] = ''; lineLastFinish[l] = ''; }

  const weights = cfg.lineSelectWeights;

  for (const mo of sortedOrders) {
    // ── 获取有效工段 ──
    let productStages: any[] = mo._stages || [];
    if (productStages.length === 0) {
      exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: 'NO_STAGE_MAPPING', severity: 'BLOCKER', message: 'No stage mapping' });
      continue;
    }
    const activeStages = strategy.getActiveStages();
    if (activeStages.length > 0) {
      productStages = productStages.filter((s: any) => activeStages.includes(s.stageName));
    }
    if (productStages.length === 0) continue;

    for (const stage of productStages) {
      const stageName = stage.stageName;

      // ── 获取允许产线 ──
      let allowedLines: string[];
      if (mo.keyAccount) {
        const mapping = await ruleEngine.getCustomerLines(mo.keyAccount);
        allowedLines = (mapping && mapping.assignedLines.length > 0)
          ? mapping.assignedLines
          : strategy.getFallbackLines();
      } else {
        allowedLines = strategy.getFallbackLines();
      }

      if (allowedLines.length === 0) {
        exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: 'NO_CANDIDATE_LINE', severity: 'BLOCKER', message: `Stage ${stageName}: no candidate lines` });
        continue;
      }

      // ── 查询 UPH ──
      let uph = 0;
      let headcount = 1;
      try {
        const routeRepo = ctx.db.getRepository('dn_operrouteline');
        const routes = await routeRepo.find({ filter: { item: mo.itemId, status: 1 }, paginate: false }) as any[];
        for (const r of routes) {
          if ((r.oper || '').toLowerCase().includes(stageName.toLowerCase()) && Number(r.erpupph) > 0) {
            headcount = Number(r.planninglabor) || 1;
            uph = Math.round(Number(r.erpupph) * headcount * 100) / 100;
            break;
          }
        }
      } catch { /* ignore */ }

      if (uph <= 0) {
        exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: 'NO_ROUTE', severity: 'BLOCKER', message: `Stage ${stageName}: no route for ${mo.itemId}` });
        continue;
      }

      const dlvStr = mo.dlvDate instanceof Date ? formatDate(mo.dlvDate) : String(mo.dlvDate || '').split('T')[0];
      const prevCompletion = sdm.getPreviousStageCompletion(mo.prodId, stageName);
      const earliestStart = prevCompletion ? addDays(prevCompletion, 1) : today;

      // JIT 缓冲：targetDlv 用于产线评分的窗口上限
      const bufferDlv = addDays(dlvStr, -cfg.jitBufferDays);
      const targetDlv = bufferDlv >= today ? bufferDlv : dlvStr;

      // ── 产线评分 ──
      const rankedLines = rankCandidateLines(
        allowedLines, lineCodes, lineLoad, lineLastItem,
        capacityPool, mo, uph, earliestStart, targetDlv, weights,
      );

      if (rankedLines.length === 0) {
        exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: 'NO_AVAILABLE_LINE', severity: 'BLOCKER', message: `Stage ${stageName}: no available line` });
        continue;
      }

      // ── Combo 枚举：不加班→加班，单线→多线 ──
      let bestResult: any = null;
      const maxLines = rankedLines.length;

      for (const allowOT of [false, true]) {
        for (let numLines = 1; numLines <= maxLines; numLines++) {
          const combos = numLines === 1
            ? rankedLines.slice(0, 1).map((l: string) => [l])
            : getCombinations(rankedLines.slice(0, Math.min(numLines, 4)), numLines);

          for (const linesToTry of combos) {
            const setupH = linesToTry.some((l: string) => lineLastItem[l] !== mo.itemId) ? cfg.setupTimeHours : 0;

            // 顺序约束：本订单必须在该产线上一单完成后才能开始。
            // 优化：若上一单当天未用满产能（如仅生产了 0.3h），下一单可在同一天继续，
            //       充分利用当天剩余工时；若当天已耗尽（used≈available），则顺移至次日。
            const primaryLine = linesToTry[0] || '';
            const lineFinishDate = lineLastFinish[primaryLine] || '';
            const lineEarliestDate = lineFinishDate
              ? (capacityPool.getAvailableHours(primaryLine, lineFinishDate) > 0
                ? lineFinishDate               // 当天还有剩余产能，复用同一天
                : addDays(lineFinishDate, 1))  // 当天已满，顺移至次日
              : today;
            const effectiveEarliestStart = lineEarliestDate > earliestStart ? lineEarliestDate : earliestStart;

            // JIT + 缓冲：找到最晚能让订单在 targetDlv（= dlvDate - jitBufferDays）
            // 前完成的起始日。
            //   - 正常情况：订单提前 jitBufferDays 天完成，给交期留出缓冲
            //   - 产线排队紧张时：calcLatestStart 回退到 effectiveEarliestStart
            //     （ASAP fallback），尽早完成，标记为 AT_RISK
            // 注：lineLastFinish 已保证线上无断点，使用 targetDlv 安全可靠。
            const startFrom = calcLatestStart(
              capacityPool, linesToTry, uph, mo.qtySched, setupH,
              targetDlv,              // 目标：在 dlvDate - buffer 前完成
              effectiveEarliestStart, // 下限：不早于产线空闲日
              true,
            );
            const res = tryScheduleStage(mo, linesToTry, capacityPool, allowOT, uph, dlvStr, effectiveEarliestStart, lineLastItem, cfg.setupTimeHours, startFrom);

            // ── 方案选择 ──────────────────────────────────────────
            if (res.success && res.finishDate <= dlvStr) {
              // 交期内方案：根据策略优选准则选最优
              //   ESG (preferEarlyFinish=true)  → 最早完成日：
              //     当前单越早完成，产线越早释放，后续单起始日越早，
              //     整体按时交付率越高。系统会主动选择加班方案。
              //   EE  (preferEarlyFinish=false) → 最低成本：
              //     订单独立，不需要为后续订单减少占用，按成本最优即可。
              const betterOnTime = !bestResult
                || !bestResult.success || bestResult.finishDate > dlvStr  // 之前没有交期内方案
                || (cfg.preferEarlyFinish
                  ? res.finishDate < bestResult.finishDate                 // ESG: 越早完成越好
                  : res.costEstimate.totalCost < bestResult.costEstimate.totalCost); // EE: 越便宜越好
              if (betterOnTime) bestResult = res;
            } else if (!bestResult || !bestResult.success || bestResult.finishDate > dlvStr) {
              // 无交期内方案时，兜底：选剩余量最少的（尽量少逾期）
              if (!bestResult || res.remaining < (bestResult.remaining ?? Infinity)) {
                bestResult = res;
              }
            }
          }
        }
      }

      // ── 异常处理 ──
      if (!bestResult || bestResult.remaining > 0) {
        exceptions.push({
          prodId: mo.prodId, itemId: mo.itemId,
          exceptionType: bestResult?.remaining > 0 ? 'CAPACITY_INSUFFICIENT' : 'SCHEDULE_FAILED',
          severity: bestResult?.remaining > 0 ? 'WARNING' : 'BLOCKER',
          message: `Stage ${stageName}: ${bestResult?.remaining > 0 ? `remaining ${Math.round(bestResult.remaining)}` : 'no feasible plan'}`,
        });
        if (!bestResult) continue;
      }

      // ── 提交最优方案 ──
      const committed = commitBestResult(
        mo, bestResult, allowedLines, stageName, uph, headcount,
        dlvStr, today, lineLastItem, lineLoad, lineLastFinish, capacityPool, cfg,
      );
      results.push(...committed);

      // 更新 SDM：记录本工段完成日期，供后续工段计算 earliestStart
      const stageFinish = committed.map((r) => r.finishDate).sort().pop();
      if (stageFinish) {
        sdm.recordStageCompletion(mo.prodId, stageName, stageFinish);
      }
    }
  }

  // 补齐 dailyPlan：从 startDate 到 finishDate 的所有日期（含 0 产量）
  for (const r of results) {
    const dp = r.dailyPlan || {};
    const padded: Record<string, number> = {};
    const cursor = new Date(r.startDate);
    const end = new Date(r.finishDate);
    while (cursor <= end) {
      const d = formatDate(cursor);
      padded[d] = dp[d] || 0;
      cursor.setDate(cursor.getDate() + 1);
    }
    r.dailyPlan = padded;
  }

  // 产线利用率统计
  const lineUtilization = lineCodes.map((line) => {
    const totalCap = capacityPool.getMaxLoad(line);
    const used = capacityPool.getTotalLoad(line);
    return {
      line,
      totalCapacityHours: Math.round(totalCap * 10) / 10,
      usedHours: Math.round(used * 10) / 10,
      utilizationRate: totalCap > 0 ? Math.round((used / totalCap) * 1000) / 10 : 0,
      orderCount: results.filter((r: any) => r.chosenLine === line).length,
    };
  });

  return { results, exceptions, lineUtilization };
}
