/**
 * scheduling/backtrack.ts
 *
 * Staged OT backtrack (reset-based, Option B).
 *
 * When the current order is still overdue after the main combo:
 *   For depth = 1..MAX_BACKTRACK_DEPTH:
 *     1. Start from original state (restored at end of each failed depth)
 *     2. Roll back last `depth` previous orders from pool
 *     3. Re-schedule them with allowOT=true, from oldest to newest
 *     4. Re-try current order (no OT first, then OT)
 *     5. If current order now on-time: keep state, update results[], return
 *     6. If still late: restore original state (Option B reset), try next depth
 */

import { CapacityPool } from '../../engines';
import type { SchedulingStrategy } from '../strategies';
import type { LineHistEntry } from './types';
import { addDays } from './config';
import { tryScheduleStage } from './tryScheduleStage';
import { commitBestResult } from './commitResult';

/** Maximum number of previous orders to backtrack over */
const MAX_BACKTRACK_DEPTH = 3;

/** Parameters for backtrackBoostHeadcount */
export type BacktrackParams = {
  bestResult: any;
  mo: any;
  dlvStr: string;
  uph: number;
  headcount: number;
  earliestStart: string;
  today: string;
  rankedLines: string[];
  lineHistory: Record<string, LineHistEntry[]>;
  lineLastFinish: Record<string, string>;
  lineLastItem: Record<string, string>;
  lineLoad: Record<string, number>;
  capacityPool: CapacityPool;
  cfg: ReturnType<SchedulingStrategy['getConfig']>;
  results: any[];
};

/**
 * Try adding OT to progressively more previous orders to free capacity,
 * so the current overdue order can be scheduled on time.
 *
 * Option B (reset-based): every depth attempt starts from original state.
 */
export function backtrackBoostHeadcount(params: BacktrackParams): any {
  const {
    bestResult: initialBest, mo, dlvStr, uph, headcount,
    earliestStart, today, rankedLines, lineHistory,
    lineLastFinish, lineLastItem, lineLoad, capacityPool, cfg, results,
  } = params;

  let bestResult = initialBest;

  // only trigger when current order is still overdue
  if (bestResult && bestResult.finishDate <= dlvStr) return bestResult;
  if (rankedLines.length === 0) return bestResult;

  const primaryLine = rankedLines[0];
  const stack = lineHistory[primaryLine];
  if (!stack || stack.length === 0) return bestResult;

  const maxDepth = Math.min(stack.length, MAX_BACKTRACK_DEPTH);

  // ── Save original state (restored between depth attempts) ────────────
  const origLineLastFinish = { ...lineLastFinish };
  const origLineLoad       = { ...lineLoad };
  const origLineLastItem   = { ...lineLastItem };

  for (let depth = 1; depth <= maxDepth; depth++) {

    // ── Step 2: Roll back last `depth` orders (most recent first) ─────
    for (let i = 0; i < depth; i++) {
      const hist = stack[stack.length - 1 - i];
      for (const [ln, dateHoursMap] of Object.entries(hist.allocatedPerLine)) {
        for (const [date, hrs] of Object.entries(dateHoursMap)) {
          capacityPool.release(ln, date, hrs);
        }
      }
      for (const [ln, delta] of Object.entries(hist.lineLoadDeltaPerLine)) {
        lineLoad[ln] = Math.max(0, (lineLoad[ln] || 0) - delta);
      }
    }
    // restore lineLastFinish to before the oldest rolled-back order
    const deepestHist = stack[stack.length - depth];
    lineLastFinish[primaryLine] = deepestHist.lineFinishBefore[primaryLine] || '';
    // restore lineLastItem to pre-range state
    Object.assign(lineLastItem, origLineLastItem);

    // ── Step 3: Re-schedule rolled-back orders with OT=true (oldest first)
    let rangeSuccess = true;
    const newAllocs: Array<{
      hist: LineHistEntry;
      committed: any[];
      newAllocatedPerLine: Record<string, Record<string, number>>;
      newLineLoadDelta: Record<string, number>;
    }> = [];

    RESCHEDULING:
    for (let i = depth - 1; i >= 0; i--) {
      const hist = stack[stack.length - 1 - i];
      const line = hist.linesToTry[0];

      // sequential start from where previous re-scheduled order ended
      const lfd = lineLastFinish[line] || '';
      const led = lfd
        ? (capacityPool.getAvailableHours(line, lfd) > 0 ? lfd : addDays(lfd, 1))
        : today;
      const ees = led > hist.effectiveEarliestStart ? led : hist.effectiveEarliestStart;

      const bRes = tryScheduleStage(
        hist.orderRef, hist.linesToTry, capacityPool,
        true,          // allowOT = true (backtrack: add overtime to previous order)
        hist.uph,
        hist.dlvStr, ees, lineLastItem, hist.setupH,
        ees,           // startFrom = ees (sequential, no JIT)
      );

      if (!bRes.success) {
        rangeSuccess = false;
        break RESCHEDULING;
      }

      // snapshot capacity before commit
      const preAvail: Record<string, Record<string, number>> = {};
      for (const ln of hist.linesToTry) {
        preAvail[ln] = {};
        for (const date of Object.keys((bRes.dailyPlans[ln] as object) || {})) {
          preAvail[ln][date] = capacityPool.getAvailableHours(ln, date);
        }
      }
      const lineLoadBefore: Record<string, number> = {};
      for (const ln of hist.linesToTry) lineLoadBefore[ln] = lineLoad[ln] || 0;

      // commit to pool (so subsequent orders in range see updated state)
      const committed = commitBestResult(
        hist.orderRef, bRes, hist.allowedLines, hist.stageName,
        hist.uph, hist.uph,                       // routeUph = effectiveUph (OT only, no headcount increase)
        hist.baseHeadcount, hist.baseHeadcount,   // headcount = actualHeadcount
        hist.dlvStr, today,
        lineLastItem, lineLoad, lineLastFinish, capacityPool, cfg,
      );

      // track newly allocated capacity
      const newAllocatedPerLine: Record<string, Record<string, number>> = {};
      for (const [ln, preMap] of Object.entries(preAvail)) {
        newAllocatedPerLine[ln] = {};
        for (const [date, pre] of Object.entries(preMap)) {
          const diff = pre - capacityPool.getAvailableHours(ln, date);
          if (diff > 0.001) newAllocatedPerLine[ln][date] = diff;
        }
      }
      const newLineLoadDelta: Record<string, number> = {};
      for (const ln of hist.linesToTry) {
        newLineLoadDelta[ln] = Math.max(0, (lineLoad[ln] || 0) - (lineLoadBefore[ln] || 0));
      }

      const finish = committed.map((r: any) => r.finishDate).sort().pop() ?? '';
      if (finish) lineLastFinish[line] = finish;

      newAllocs.push({ hist, committed, newAllocatedPerLine, newLineLoadDelta });
    }

    // ── Step 4: Re-try current order if range re-schedule succeeded ────
    if (rangeSuccess) {
      let retryResult: any = null;

      for (const allowOT of [false, true]) {
        const lfd = lineLastFinish[primaryLine] || '';
        const led = lfd
          ? (capacityPool.getAvailableHours(primaryLine, lfd) > 0 ? lfd : addDays(lfd, 1))
          : today;
        const retryEes = led > earliestStart ? led : earliestStart;
        const retrySetupH = lineLastItem[primaryLine] !== mo.itemId ? cfg.setupTimeHours : 0;

        const retryRes = tryScheduleStage(
          mo, [primaryLine], capacityPool, allowOT, uph,
          dlvStr, retryEes, lineLastItem, retrySetupH, retryEes,
        );
        if (retryRes) {
          (retryRes as any)._allowOT               = allowOT;
          (retryRes as any)._hc                    = headcount;
          (retryRes as any)._effectiveEarliestStart = retryEes;
          (retryRes as any)._setupH                = retrySetupH;
        }

        if (retryRes.success && retryRes.finishDate <= dlvStr) {
          // ✅ Current order now on-time: keep re-scheduled state
          bestResult = retryRes;

          // update results[] for all re-scheduled range orders
          for (const na of newAllocs) {
            for (let j = 0; j < na.hist.resultCount && j < na.committed.length; j++) {
              const idx = na.hist.resultStartIdx + j;
              if (idx < results.length) results[idx] = na.committed[j];
            }
            // update hist snapshot so future backtrack at deeper depth is accurate
            na.hist.allocatedPerLine    = na.newAllocatedPerLine;
            na.hist.lineLoadDeltaPerLine = na.newLineLoadDelta;
            na.hist.allowOT              = true;
          }
          return bestResult;
        }

        if (!retryResult || retryRes.remaining < (retryResult.remaining ?? Infinity)) {
          retryResult = retryRes;
        }
      }

      // still overdue: track best improvement
      if (retryResult && (!bestResult || !bestResult.success || bestResult.finishDate > dlvStr)) {
        if (!bestResult || retryResult.remaining < (bestResult.remaining ?? Infinity)) {
          bestResult = retryResult;
        }
      }
    }

    // ── Step 5: Restore original state (Option B reset) ─────────────────
    // 5a. Release newly committed OT allocations (reverse order)
    for (let j = newAllocs.length - 1; j >= 0; j--) {
      const na = newAllocs[j];
      for (const [ln, map] of Object.entries(na.newAllocatedPerLine)) {
        for (const [date, hrs] of Object.entries(map)) {
          capacityPool.release(ln, date, hrs);
        }
      }
      for (const [ln, delta] of Object.entries(na.newLineLoadDelta)) {
        lineLoad[ln] = Math.max(0, (lineLoad[ln] || 0) - delta);
      }
    }
    // 5b. Re-allocate original historical capacity for rolled-back orders
    for (let i = 0; i < depth; i++) {
      const hist = stack[stack.length - 1 - i];
      for (const [ln, map] of Object.entries(hist.allocatedPerLine)) {
        for (const [date, hrs] of Object.entries(map)) {
          capacityPool.allocate(ln, date, hrs);
        }
      }
      for (const [ln, delta] of Object.entries(hist.lineLoadDeltaPerLine)) {
        lineLoad[ln] = (lineLoad[ln] || 0) + delta;
      }
    }
    // 5c. Restore line tracking to original values
    lineLastFinish[primaryLine] = origLineLastFinish[primaryLine] || '';
    Object.assign(lineLastItem, origLineLastItem);
    Object.assign(lineLoad, origLineLoad);

    // continue to next depth with fresh original state
  }

  return bestResult;
}