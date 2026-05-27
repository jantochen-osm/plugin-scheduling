/**
 * scheduling/tryScheduleStage.ts
 *
 * 单工段排产模拟（试算 + rollback）：
 *   给定一个起始日和候选产线组合，逐日分配产能，
 *   返回 dailyPlan 方案及成本估算。
 *   内部做 rollback，不会真正改变产能池状态。
 *
 * 也包含 getCombinations 辅助函数。
 */

import { CapacityPool } from '../../engines';
import { addDays, formatDate, SCHEDULING_CONFIG } from './config';

// ── 辅助：产线组合枚举 ──────────────────────────────────────────────
/** 从 arr 中取 k 个元素的所有组合 */
export function getCombinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > arr.length) return [];
  const result: T[][] = [];
  function dfs(start: number, current: T[]) {
    if (current.length === k) { result.push([...current]); return; }
    for (let i = start; i < arr.length; i++) {
      current.push(arr[i]);
      dfs(i + 1, current);
      current.pop();
    }
  }
  dfs(0, []);
  return result;
}

// ── 主函数：单工段排产模拟 ──────────────────────────────────────────
/**
 * 模拟从 startFrom 开始，在 linesToTry 上逐日排产，直到完成或到达 dlvStr。
 * 所有产能分配在函数结束时 rollback，调用方需根据返回结果自行决定是否提交。
 *
 * @param mo              生产订单
 * @param linesToTry      候选产线（已按评分排序）
 * @param capacityPool    产能池
 * @param allowOvertime   是否允许加班
 * @param uph             每小时产量
 * @param dlvStr          交期（用于计算剩余产能和成本）
 * @param today           最早开始日（effectiveEarliestStart）
 * @param lineLastItem    各产线上一个订单的 itemId（用于判断是否需要换型）
 * @param setupTimeHours  换型时间（小时）
 * @param startFrom       JIT 后拉的起始日（由 calcLatestStart 计算）
 */
export function tryScheduleStage(
  mo: any,
  linesToTry: string[],
  capacityPool: CapacityPool,
  allowOvertime: boolean,
  uph: number,
  dlvStr: string,
  today: string,
  lineLastItem: Record<string, string>,
  setupTimeHours: number,
  startFrom?: string,
) {
  let remainingQty = mo.qtySched;
  let curDate = startFrom || today;
  let dayCount = 0;

  const dailyPlans: Record<string, Record<string, number>> = {};
  const extraPlans: Record<string, Record<string, number>> = {};
  const consumed: { line: string; date: string; hours: number }[] = [];
  const isFirstDayForLine: Record<string, boolean> = {};
  for (const l of linesToTry) {
    dailyPlans[l] = {};
    extraPlans[l] = {};
    isFirstDayForLine[l] = true;
  }

  while (remainingQty > 0 && dayCount < SCHEDULING_CONFIG.maxDays) {
    const dateStr = typeof curDate === 'string' ? curDate : formatDate(new Date(curDate));

    // 计算当前日到 dlvStr 之间的总剩余产能（用于判断是否需要加班）
    let totalRemainingCapacity = 0;
    for (const ln of linesToTry) {
      let d = new Date(dateStr);
      const endDate = new Date(dlvStr);
      while (d <= endDate) {
        totalRemainingCapacity += capacityPool.getAvailableHours(ln, formatDate(d));
        d.setDate(d.getDate() + 1);
      }
    }
    const hoursNeeded = remainingQty / uph;
    const isFallingBehind = hoursNeeded > totalRemainingCapacity;

    for (const line of linesToTry) {
      if (remainingQty <= 0) break;

      const remHours = capacityPool.getAvailableHours(line, dateStr);
      let extraHours = 0;

      // 换型时间：首次上线且前一订单品号不同时扣除
      let setupHoursToConsume = 0;
      if (isFirstDayForLine[line] && lineLastItem[line] !== mo.itemId) {
        setupHoursToConsume = setupTimeHours;
      }

      // 加班逻辑：产能不足时按需补充加班时长
      if (allowOvertime && isFallingBehind) {
        const dayWorkHours = capacityPool.getWorkHoursForDate(dateStr);
        extraHours = Math.min(dayWorkHours, (remainingQty / uph) + setupHoursToConsume - remHours);
        if (extraHours < 0) extraHours = 0;
      }

      const totalAvailableHours = remHours + extraHours;
      if (totalAvailableHours <= setupHoursToConsume + 0.1) continue; // 产能不足以开工，跳过本日

      const maxQty = (totalAvailableHours - setupHoursToConsume) * uph;
      const qtyToday = remainingQty <= maxQty ? remainingQty : Math.floor(maxQty);
      if (qtyToday <= 0) continue;

      // 拆分正常 / 加班产量（用于成本估算和 extraCapacityPlan）
      const standardHoursForSetup = Math.min(setupHoursToConsume, remHours);
      const remainingRemHoursForProduction = Math.max(0, remHours - standardHoursForSetup);
      const qtyFromStandard = Math.min(qtyToday, remainingRemHoursForProduction * uph);
      const qtyFromExtra = Math.max(0, qtyToday - qtyFromStandard);
      const standardHoursToConsume = standardHoursForSetup + (qtyFromStandard / uph);

      const allocated = capacityPool.allocate(line, dateStr, standardHoursToConsume);
      consumed.push({ line, date: dateStr, hours: allocated });

      dailyPlans[line][dateStr] = qtyToday;
      if (qtyFromExtra > 0) extraPlans[line][dateStr] = qtyFromExtra;

      isFirstDayForLine[line] = false;
      remainingQty -= qtyToday;
    }

    if (remainingQty > 0) {
      curDate = addDays(dateStr, 1);
      dayCount++;
    }
  }

  // Rollback：归还所有试算时占用的产能
  for (const c of consumed) {
    capacityPool.release(c.line, c.date, c.hours);
  }

  // 计算全局 start / finish
  let globalStart = '';
  let globalFinish = '';
  for (const line of linesToTry) {
    const dates = Object.keys(dailyPlans[line]).sort();
    if (dates.length > 0) {
      if (!globalStart || dates[0] < globalStart) globalStart = dates[0];
      if (!globalFinish || dates[dates.length - 1] > globalFinish) globalFinish = dates[dates.length - 1];
    }
  }

  // 成本估算
  const { standardHourRate, overtimeMultiplier, additionalLineMultiplier } = SCHEDULING_CONFIG.costModel;
  let totalStandardHours = 0;
  let totalOvertimeHours = 0;
  for (const line of linesToTry) {
    for (const dateStr of Object.keys(dailyPlans[line])) {
      const qty = dailyPlans[line][dateStr] || 0;
      const extraQty = (extraPlans[line] && extraPlans[line][dateStr]) || 0;
      totalStandardHours += Math.max(0, qty - extraQty) / uph;
      totalOvertimeHours += extraQty / uph;
    }
  }
  const extraLines = Math.max(0, linesToTry.length - 1);
  const standardCost = totalStandardHours * standardHourRate;
  const overtimeCost = totalOvertimeHours * standardHourRate * overtimeMultiplier;
  const extraLineCost = extraLines > 0
    ? (totalStandardHours + totalOvertimeHours) / linesToTry.length * extraLines * standardHourRate * additionalLineMultiplier
    : 0;

  return {
    success: remainingQty <= 0,
    remaining: remainingQty,
    startDate: globalStart,
    finishDate: globalFinish,
    dailyPlans,
    extraPlans,
    linesUsed: linesToTry,
    costEstimate: {
      standardHours: Math.round(totalStandardHours * 10) / 10,
      overtimeHours: Math.round(totalOvertimeHours * 10) / 10,
      linesUsedCount: linesToTry.length,
      standardCost: Math.round(standardCost * 10) / 10,
      overtimeCost: Math.round(overtimeCost * 10) / 10,
      extraLineCost: Math.round(extraLineCost * 10) / 10,
      totalCost: Math.round((standardCost + overtimeCost + extraLineCost) * 10) / 10,
    },
  };
}
