/**
 * scheduling/scheduleAll.ts
 *
 * Sequential scheduling main loop.
 * For each order:
 *   1. Line filtering (customer mapping + material routing + strategy fallback)
 *   2. UPH query (dn_operrouteline)
 *   3. Candidate line ranking (rankCandidateLines)
 *   4. Single-line x OT two-pass -> bestResult
 *   5. Backtrack OT (backtrackBoostHeadcount) -- if still overdue
 *   6. Commit bestResult (commitBestResult), update pool & line state
 */

import type { Context } from '@nocobase/actions';
import { RuleEngine, CapacityPool, StageDependencyManager } from '../../engines';
import type { SchedulingStrategy } from '../strategies';
import { addDays, formatDate, getTodayStr, SCHEDULING_CONFIG } from './config';
import { tryScheduleStage } from './tryScheduleStage';
import type { SchedulingDecision } from '../llmDecision';
import type { LineHistEntry } from './types';
import { rankCandidateLines } from './rankLines';
import { commitBestResult } from './commitResult';
import { backtrackBoostHeadcount } from './backtrack';
import { cleanDailyPlans, calcLineUtilization } from './postProcess';

// suppress TS unused-import warning (CapacityPool used only in param types)
void (CapacityPool as any);

// ── Main scheduling function ──────────────────────────────────────────────
export async function scheduleAll(
  sortedOrders: any[],
  ruleEngine: RuleEngine,
  lineCodes: string[],
  capacityPool: CapacityPool,
  ctx: Context,
  strategy: SchedulingStrategy,
  /** LLM decision map (prodId -> decision), undefined = original algorithm */
  decisionMap?: Map<string, SchedulingDecision>,
  /**
   * Optional: pre-set line state (from preOccupyPinnedResults).
   * Passed in re-schedule scenario so pinned records' line dates are respected.
   */
  initialState?: {
    lineLastFinish?: Record<string, string>;
    lineLastItem?: Record<string, string>;
  },
  /**
   * Schedule start date (YYYY-MM-DD).
   * Must match poolStart used in step5_initCapacityPool.
   * Falls back to getTodayStr() (= MOCK_TODAY) if not supplied.
   */
  scheduleStartDate?: string,
) {
  const results: any[]    = [];
  const exceptions: any[] = [];
  const sdm = new StageDependencyManager();
  const today = (scheduleStartDate && /^\d{4}-\d{2}-\d{2}$/.test(scheduleStartDate))
    ? scheduleStartDate
    : getTodayStr();
  const cfg = strategy.getConfig();

  // collect stage sequences from all orders and register to SDM
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

  // ── line state tracking ───────────────────────────────────────────────
  const lineLoad:       Record<string, number>            = {};
  const lineLastItem:   Record<string, string>            = {};
  const lineLastFinish: Record<string, string>            = {};
  const lineHistory:    Record<string, LineHistEntry[]>   = {};  // per-line history stack
  for (const l of lineCodes) {
    lineLoad[l] = 0; lineLastItem[l] = ''; lineLastFinish[l] = ''; lineHistory[l] = [];
  }

  // override with pinned results state when re-scheduling
  if (initialState?.lineLastFinish) {
    for (const [line, date] of Object.entries(initialState.lineLastFinish)) {
      if (date) lineLastFinish[line] = date;
    }
  }
  if (initialState?.lineLastItem) {
    for (const [line, item] of Object.entries(initialState.lineLastItem)) {
      if (item) lineLastItem[line] = item;
    }
  }

  const weights = cfg.lineSelectWeights;

  // ── Main loop: schedule each order ───────────────────────────────────
  for (const mo of sortedOrders) {

    // ── LLM skip check ──
    const dec = decisionMap?.get(mo.prodId);
    if (dec?.skip) {
      exceptions.push({
        prodId:        mo.prodId,
        itemId:        mo.itemId,
        exceptionType: 'LLM_SKIP',
        severity:      'WARNING',
        message:       dec.skipReason || 'LLM skipped this order',
      });
      continue;
    }

    // ── get active stages ──
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

      // ── allowed lines ──
      let allowedLines: string[];
      if (mo.keyAccount) {
        const mapping = await ruleEngine.getCustomerLines(mo.keyAccount);
        allowedLines = (mapping && mapping.assignedLines.length > 0)
          ? mapping.assignedLines
          : strategy.getFallbackLines();
      } else {
        allowedLines = strategy.getFallbackLines();
      }

      // ESG material prefix routing: AMZ-55- / 55- -> 4F2 (Chicha)
      if (strategy.name === 'ESG') {
        const itemId = mo.itemId || '';
        if (/^(AMZ-55-|55-)/i.test(itemId)) {
          allowedLines = ['4F2'];
        }
      }

      if (allowedLines.length === 0) {
        exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: 'NO_CANDIDATE_LINE', severity: 'BLOCKER', message: `Stage ${stageName}: no candidate lines` });
        continue;
      }

      // ── UPH query ──
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
      const earliestStart  = prevCompletion ? addDays(prevCompletion, 1) : today;

      // sequential mode: delivery date IS the target (no JIT buffer)
      let rankedLines = rankCandidateLines(
        allowedLines, lineCodes, lineLoad, lineLastItem,
        lineLastFinish, capacityPool, mo, uph, earliestStart, dlvStr, weights,
      );

      // LLM guidance: push preferred lines to front
      if (dec?.preferredLines?.length) {
        const preferred = dec.preferredLines.filter((l) => rankedLines.includes(l));
        const rest      = rankedLines.filter((l) => !preferred.includes(l));
        rankedLines = [...preferred, ...rest];
      }

      if (rankedLines.length === 0) {
        exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: 'NO_AVAILABLE_LINE', severity: 'BLOCKER', message: `Stage ${stageName}: no available line` });
        continue;
      }

      // ── Single-line x OT two-pass (sequential / continuous scheduling) ─
      // Pass 1: no overtime; Pass 2: overtime
      // Within each pass: try lines in ranked order, single line only
      let bestResult: any = null;

      for (const allowOT of [false, true]) {
        if (bestResult?.finishDate <= dlvStr) break;   // already on-time, stop

        for (const line of rankedLines) {
          // sequential start: from where previous order on this line ended
          const lineFinishDate = lineLastFinish[line] || '';
          const lineEarliestDate = lineFinishDate
            ? (capacityPool.getAvailableHours(line, lineFinishDate) > 0
                ? lineFinishDate
                : addDays(lineFinishDate, 1))
            : today;
          const ees = lineEarliestDate > earliestStart ? lineEarliestDate : earliestStart;
          const setupH = lineLastItem[line] !== mo.itemId ? cfg.setupTimeHours : 0;

          const res = tryScheduleStage(
            mo, [line], capacityPool, allowOT, uph,
            dlvStr, ees, lineLastItem, setupH,
            ees,   // startFrom = ees: sequential, no JIT pull-back
          );
          if (res) {
            (res as any)._allowOT               = allowOT;
            (res as any)._effectiveEarliestStart = ees;
            (res as any)._setupH                 = setupH;
            (res as any)._hc                     = headcount;
          }

          if (res.success && res.finishDate <= dlvStr) {
            // on-time: prefer lower cost
            if (!bestResult || !bestResult.success || bestResult.finishDate > dlvStr
                || res.costEstimate.totalCost < bestResult.costEstimate.totalCost) {
              bestResult = res;
            }
          } else if (!bestResult || !bestResult.success || bestResult.finishDate > dlvStr) {
            // overdue: prefer smaller remaining (closest to on-time)
            if (!bestResult || res.remaining < (bestResult.remaining ?? Infinity)) {
              bestResult = res;
            }
          }
        }
      }

      // ── Staged OT backtrack (if still overdue) ──────────────────────
      bestResult = backtrackBoostHeadcount({
        bestResult, mo, dlvStr, uph, headcount,
        earliestStart, today,
        rankedLines, lineHistory,
        lineLastFinish, lineLastItem, lineLoad,
        capacityPool, cfg, results,
      });

      // ── exception recording ──
      if (!bestResult || bestResult.remaining > 0) {
        exceptions.push({
          prodId: mo.prodId, itemId: mo.itemId,
          exceptionType: bestResult?.remaining > 0 ? 'CAPACITY_INSUFFICIENT' : 'SCHEDULE_FAILED',
          severity:      bestResult?.remaining > 0 ? 'WARNING' : 'BLOCKER',
          message:       `Stage ${stageName}: ${bestResult?.remaining > 0 ? `remaining ${Math.round(bestResult.remaining)}` : 'no feasible plan'}`,
        });
        if (!bestResult) continue;
      }

      // ── commit best result ────────────────────────────────────────────
      const primaryLineForHist     = (bestResult.linesUsed?.[0]) || rankedLines[0] || '';
      const lineFinishBeforeCommit = { ...lineLastFinish };
      const lineLoadBeforeCommit   = { ...lineLoad };

      // pre-snapshot for backtrack release
      const preAvailForHist: Record<string, Record<string, number>> = {};
      for (const line of (bestResult.linesUsed || [primaryLineForHist])) {
        preAvailForHist[line] = {};
        for (const date of Object.keys((bestResult.dailyPlans[line] as object) || {})) {
          preAvailForHist[line][date] = capacityPool.getAvailableHours(line, date);
        }
      }

      const committed = commitBestResult(
        mo, bestResult, allowedLines, stageName,
        uph, uph,            // routeUph = effectiveUph (standard headcount, OT only)
        headcount, headcount, // headcount = actualHeadcount (no headcount increase)
        dlvStr, today, lineLastItem, lineLoad, lineLastFinish, capacityPool, cfg,
      );
      results.push(...committed);

      // calculate actual allocated hours (for future backtrack release)
      const allocatedPerLine: Record<string, Record<string, number>> = {};
      for (const [line, preMap] of Object.entries(preAvailForHist)) {
        allocatedPerLine[line] = {};
        for (const [date, pre] of Object.entries(preMap)) {
          const diff = pre - capacityPool.getAvailableHours(line, date);
          if (diff > 0.001) allocatedPerLine[line][date] = diff;
        }
      }
      const lineLoadDeltaPerLine: Record<string, number> = {};
      for (const line of Object.keys(preAvailForHist)) {
        lineLoadDeltaPerLine[line] = Math.max(0, (lineLoad[line] || 0) - (lineLoadBeforeCommit[line] || 0));
      }

      // push to line history stack
      if (primaryLineForHist && committed.length > 0) {
        if (!lineHistory[primaryLineForHist]) lineHistory[primaryLineForHist] = [];
        lineHistory[primaryLineForHist].push({
          orderRef:               mo,
          stageName,
          linesToTry:             bestResult.linesUsed || [primaryLineForHist],
          allowedLines,
          effectiveEarliestStart: (bestResult as any)._effectiveEarliestStart ?? today,
          dlvStr,
          uph,
          baseHeadcount:   headcount,
          headcountUsed:   headcount,
          allowOT:         (bestResult as any)._allowOT ?? false,
          setupH:          (bestResult as any)._setupH ?? 0,
          allocatedPerLine,
          lineLoadDeltaPerLine,
          lineFinishBefore:  lineFinishBeforeCommit,
          resultStartIdx:    results.length - committed.length,
          resultCount:       committed.length,
        });
      }

      // update SDM: record stage completion for subsequent stage earliestStart
      const stageFinish = committed.map((r) => r.finishDate).sort().pop();
      if (stageFinish) {
        sdm.recordStageCompletion(mo.prodId, stageName, stageFinish);
      }
    }
  }

  // ── post-processing ───────────────────────────────────────────────────
  cleanDailyPlans(results);
  const lineUtilization = calcLineUtilization(lineCodes, capacityPool, results);

  return { results, exceptions, lineUtilization };
}

// re-export preOccupyPinnedResults (keep public API stable)
export { preOccupyPinnedResults } from './preOccupy';