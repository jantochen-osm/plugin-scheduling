/**
 * scheduling/backtrack.ts
 *
 * 回溯增人逻辑（Headcount Boost Backtrack）。
 *
 * 当当前订单仍逾期时，尝试对前序已提交订单增加人手，
 * 使其更早完成并释放产线，从而让当前订单有机会准时交货。
 *
 * 算法：
 *   1. 回滚前序订单的产能占用与 lineLoad
 *   2. 双重搜索（增人 × 提前开工）找使前序更早完成的最小增人方案
 *   3. 提交前序增人方案，更新 lineHistory
 *   4. 用更新后的 lineLastFinish 重试当前订单（主 Combo 枚举同款循环）
 *   5. 若回溯失败，恢复前序的原始产能占用
 */

import { CapacityPool } from '../../engines';
import type { SchedulingStrategy } from '../strategies';
import type { LineHistEntry } from './types';
import { addDays, getTodayStr } from './config';
import { calcLatestStart } from './calcLatestStart';
import { tryScheduleStage } from './tryScheduleStage';
import { commitBestResult } from './commitResult';

/** backtrackBoostHeadcount 的参数包 */
export type BacktrackParams = {
  /** 当前排产结果（bestResult 仍逾期时传入） */
  bestResult: any;
  /** 当前订单 */
  mo: any;
  /** 当前订单 dlvStr */
  dlvStr: string;
  /** 当前订单 UPH */
  uph: number;
  /** 当前订单基准人数 */
  headcount: number;
  /** 当前订单 uphPerPerson */
  uphPerPerson: number;
  /** 当前订单最早开工日 */
  earliestStart: string;
  /** 当前订单 targetDlv（含 JIT 缓冲） */
  targetDlv: string;
  /** 当前订单提前开工最大天数 */
  earlyStartMaxDays: number;
  /** 当前订单最大人数 */
  maxHc: number;
  /** 排名后的候选产线（首元素为首选产线） */
  rankedLines: string[];
  /** 产线历史记录（可变，回溯后会更新） */
  lineHistory: Record<string, LineHistEntry | null>;
  /** 产线最后完成日期（可变） */
  lineLastFinish: Record<string, string>;
  /** 产线最后物料（可变） */
  lineLastItem: Record<string, string>;
  /** 产线累计负载（可变） */
  lineLoad: Record<string, number>;
  /** 产能池（可变） */
  capacityPool: CapacityPool;
  /** 策略配置 */
  cfg: ReturnType<SchedulingStrategy['getConfig']>;
  /** 已提交结果数组（可变，回溯后会替换前序记录） */
  results: any[];
};

/**
 * 尝试对前序订单增人，使当前逾期订单有机会准时。
 * 直接修改 bestResult（传引用包装），若找到更好方案则更新 params.bestResult。
 *
 * @returns 新的 bestResult（若改善）或原 bestResult（若回溯无效）
 */
export function backtrackBoostHeadcount(params: BacktrackParams): any {
  const {
    bestResult: initialBest, mo, dlvStr, uph, headcount, uphPerPerson,
    earliestStart, targetDlv, earlyStartMaxDays, maxHc,
    rankedLines, lineHistory, lineLastFinish, lineLastItem, lineLoad,
    capacityPool, cfg, results,
  } = params;

  let bestResult = initialBest;

  // 只在当前单仍逾期时触发回溯
  if (!(!bestResult || bestResult.finishDate > dlvStr)) return bestResult;
  if (rankedLines.length === 0) return bestResult;

  const today = getTodayStr();
  const primaryLine = rankedLines[0];
  const hist = lineHistory[primaryLine];
  const prevMaxHc = Math.round((hist?.baseHeadcount ?? 1) * (cfg.maxHeadcountFactor ?? 4));

  if (!hist || hist.headcountUsed >= prevMaxHc) return bestResult;

  // ── 1. 回滚前序订单的产能占用与 lineLoad ──
  for (const [ln, dateHoursMap] of Object.entries(hist.allocatedPerLine)) {
    for (const [date, hrs] of Object.entries(dateHoursMap)) {
      capacityPool.release(ln, date, hrs);
    }
  }
  for (const [ln, delta] of Object.entries(hist.lineLoadDeltaPerLine)) {
    lineLoad[ln] = Math.max(0, (lineLoad[ln] || 0) - delta);
  }
  const savedLineLastFinish = lineLastFinish[primaryLine];
  lineLastFinish[primaryLine] = hist.lineFinishBefore[primaryLine] || '';

  // ── 2. 双重搜索：增人 × 提前开工（找最小增人方案）──
  const prevUphPerPerson = hist.uph / hist.baseHeadcount;
  let chosenBoostHc = hist.baseHeadcount;
  let chosenBoostEarlyDays = 0;
  let chosenBoostRes: any = null;

  BOOST_SEARCH:
  for (let bHc = hist.baseHeadcount; bHc <= prevMaxHc; bHc++) {
    const bUph = Math.round(prevUphPerPerson * bHc * 100) / 100;

    for (let bEarly = 0; bEarly <= earlyStartMaxDays; bEarly++) {
      const bJitStart = calcLatestStart(
        capacityPool, hist.linesToTry, bUph, hist.orderRef.qtySched, hist.setupH,
        hist.targetDlvOfOrder, hist.effectiveEarliestStart, true,
      );
      const bShifted = bEarly === 0 ? bJitStart : addDays(bJitStart, -bEarly);
      const bStartFrom = bShifted >= hist.effectiveEarliestStart
        ? bShifted : hist.effectiveEarliestStart;

      const bRes = tryScheduleStage(
        hist.orderRef, hist.linesToTry, capacityPool, false, bUph,
        hist.dlvStr, hist.effectiveEarliestStart, lineLastItem, cfg.setupTimeHours, bStartFrom,
      );
      if (!bRes.success) continue;

      chosenBoostRes       = bRes;
      chosenBoostHc        = bHc;
      chosenBoostEarlyDays = bEarly;

      // 粗略估算：前序完成后当前单是否能准时（10h/天）
      const tentativeStart = bRes.finishDate > earliestStart ? bRes.finishDate : earliestStart;
      const neededDays = Math.ceil(mo.qtySched / uph / 10);
      const estimatedFinish = addDays(tentativeStart, neededDays);
      if (estimatedFinish <= dlvStr) break BOOST_SEARCH;
    }
  }
  void chosenBoostEarlyDays; // 防止 TS 未使用变量警告

  if (chosenBoostRes && chosenBoostRes.success) {
    const boostUph = Math.round(prevUphPerPerson * chosenBoostHc * 100) / 100;

    // ── 3a. 提交前快照 ──
    const boostPreAvail: Record<string, Record<string, number>> = {};
    for (const ln of hist.linesToTry) {
      boostPreAvail[ln] = {};
      for (const date of Object.keys((chosenBoostRes.dailyPlans[ln] as object) || {})) {
        boostPreAvail[ln][date] = capacityPool.getAvailableHours(ln, date);
      }
    }
    const boostLineLoadBefore: Record<string, number> = {};
    for (const ln of hist.linesToTry) boostLineLoadBefore[ln] = lineLoad[ln] || 0;

    // ── 3b. 提交前序订单增人方案 ──
    const boostCommitted = commitBestResult(
      hist.orderRef, chosenBoostRes, hist.allowedLines, hist.stageName,
      hist.uph,         // routeUph: 前序标准 UPH（存 DB）
      boostUph,         // effectiveUph: 增人后实际有效产能（算工时）
      hist.baseHeadcount,  // 标准基础人力（增人只体现在 dailyPlan 数量上）
      chosenBoostHc,    // actualHeadcount: 增人后实际人数
      hist.dlvStr, today,
      lineLastItem, lineLoad, lineLastFinish, capacityPool, cfg,
    );
    // commitBestResult 只更新较晚日期；增人后完成更早，需强制更新
    const boostFinish = boostCommitted.map((r: any) => r.finishDate).sort().pop() ?? '';
    if (boostFinish) lineLastFinish[primaryLine] = boostFinish;

    // ── 3c. 替换 results[] 中前序订单的记录 ──
    for (let i = 0; i < hist.resultCount; i++) {
      if (i < boostCommitted.length && hist.resultStartIdx + i < results.length) {
        results[hist.resultStartIdx + i] = boostCommitted[i];
      }
    }

    // ── 3d. 更新前序历史 ──
    const newAllocatedPerLine: Record<string, Record<string, number>> = {};
    for (const [ln, preMap] of Object.entries(boostPreAvail)) {
      newAllocatedPerLine[ln] = {};
      for (const [date, pre] of Object.entries(preMap)) {
        const diff = pre - capacityPool.getAvailableHours(ln, date);
        if (diff > 0.001) newAllocatedPerLine[ln][date] = diff;
      }
    }
    const newLoadDelta: Record<string, number> = {};
    for (const ln of hist.linesToTry) {
      newLoadDelta[ln] = Math.max(0, (lineLoad[ln] || 0) - (boostLineLoadBefore[ln] || 0));
    }
    lineHistory[primaryLine] = {
      ...hist, headcountUsed: chosenBoostHc,
      allocatedPerLine: newAllocatedPerLine,
      lineLoadDeltaPerLine: newLoadDelta,
    };

    // ── 4. 用更新后的 lineLastFinish 重试当前订单 ──
    for (let hc = headcount; hc <= maxHc; hc++) {
      if (bestResult?.finishDate <= dlvStr) break;
      const effectiveUph = Math.round(uphPerPerson * hc * 100) / 100;

      for (const allowOT of [false, true]) {
        if (bestResult?.finishDate <= dlvStr) break;

        for (let earlyDays = 0; earlyDays <= earlyStartMaxDays; earlyDays++) {
          if (bestResult?.finishDate <= dlvStr) break;

          const lfDateR = lineLastFinish[primaryLine] || '';
          const leDateR = lfDateR
            ? (capacityPool.getAvailableHours(primaryLine, lfDateR) > 0
              ? lfDateR : addDays(lfDateR, 1))
            : today;
          const eesR = leDateR > earliestStart ? leDateR : earliestStart;
          const retrySetupH = lineLastItem[primaryLine] !== mo.itemId ? cfg.setupTimeHours : 0;

          const jitStartR = calcLatestStart(
            capacityPool, [primaryLine], effectiveUph, mo.qtySched, retrySetupH,
            targetDlv, eesR, true,
          );
          const shiftedR   = earlyDays === 0 ? jitStartR : addDays(jitStartR, -earlyDays);
          const startFromR = shiftedR >= eesR ? shiftedR : eesR;

          const retryRes = tryScheduleStage(
            mo, [primaryLine], capacityPool, allowOT, effectiveUph,
            dlvStr, eesR, lineLastItem, cfg.setupTimeHours, startFromR,
          );
          if (retryRes) {
            (retryRes as any)._hc                    = hc;
            (retryRes as any)._setupH                = retrySetupH;
            (retryRes as any)._effectiveEarliestStart = eesR;
            (retryRes as any)._earlyDays             = earlyDays;
            (retryRes as any)._allowOT               = allowOT;
          }

          if (retryRes.success && retryRes.finishDate <= dlvStr) {
            const better = !bestResult || !bestResult.success || bestResult.finishDate > dlvStr
              || (cfg.preferEarlyFinish
                ? retryRes.finishDate < bestResult.finishDate
                : retryRes.costEstimate.totalCost < bestResult.costEstimate.totalCost);
            if (better) bestResult = retryRes;
          } else if (!bestResult || !bestResult.success || bestResult.finishDate > dlvStr) {
            if (!bestResult || retryRes.remaining < (bestResult.remaining ?? Infinity)) {
              bestResult = retryRes;
            }
          }
        }
      }
    }

  } else {
    // ── 5. 回溯失败，恢复前序原始产能占用 ──
    for (const [ln, dateHoursMap] of Object.entries(hist.allocatedPerLine)) {
      for (const [date, hrs] of Object.entries(dateHoursMap)) {
        capacityPool.allocate(ln, date, hrs);
      }
    }
    for (const [ln, delta] of Object.entries(hist.lineLoadDeltaPerLine)) {
      lineLoad[ln] = (lineLoad[ln] || 0) + delta;
    }
    lineLastFinish[primaryLine] = savedLineLastFinish || '';
  }

  return bestResult;
}
