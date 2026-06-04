/**
 * scheduling/preOccupy.ts
 *
 * 锁定记录产能预占（Pinned Results Pre-Occupation）。
 *
 * 重算（reScheduleAfterAdjust）时，在初始化产能池后、scheduleAll 执行前调用，
 * 将 isManualAdjusted=true 的锁定记录占用到产能池，使调度器感知已承诺的产能。
 *
 * ⚠️ 设计决策：本模块「只预占产能，不更新 lineLastFinish / lineLastItem」
 *   锁定订单的语义是"该日期/产线的产能已承诺"，而不是"其他订单必须在它之后排"。
 *   若更新 lineLastFinish，调度器会把所有后续订单连锁推到锁定日期之后，
 *   导致高优先级逾期单也被错误延后，违背交期优先规则。
 *   lineLastFinish / lineLastItem 由 scheduleAll 主循环在排完每个非锁定订单后自动维护。
 */

import { CapacityPool } from '../../engines';
import { formatDate, getTodayStr } from './config';

/**
 * 将 isManualAdjusted=true 的锁定记录预先占用到产能池。
 *
 * @param pinnedResults   isManualAdjusted=true 的排产记录数组
 * @param capacityPool    已初始化的产能池（step5 产物）
 * @param lineLastFinish  保留参数（本函数不写入，由 scheduleAll 主循环维护）
 * @param lineLastItem    保留参数（本函数不写入，由 scheduleAll 主循环维护）
 */
export function preOccupyPinnedResults(
  pinnedResults: any[],
  capacityPool: CapacityPool,
  lineLastFinish: Record<string, string>,   // 保留签名兼容性，本函数不写入
  lineLastItem: Record<string, string>,     // 保留签名兼容性，本函数不写入
): void {
  // 参数保留但不使用（兼容调用方传参），显式声明避免 TS 警告
  void lineLastFinish;
  void lineLastItem;

  const todayStr = getTodayStr();
  const skippedHistorical: string[] = [];

  for (const r of pinnedResults) {
    const line = r.chosenLine;
    if (!line) continue;

    const uph = Number(r.uph) || 1;
    const dailyPlan: Record<string, number> =
      typeof r.dailyPlan === 'string'
        ? JSON.parse(r.dailyPlan || '{}')
        : (r.dailyPlan || {});

    // 从 dailyPlan 取实际有效产量的最晚日期（不用 finishDate，可能是旧排产遗留值）
    const validDates = Object.entries(dailyPlan)
      .filter(([, qty]) => (qty as number) > 0)
      .map(([d]) => d)
      .sort();
    const latestDailyPlanDate = validDates.at(-1) || '';

    // 历史日期锁定记录跳过：容量池从 today 起始，历史日期无产能槽，allocate 无效
    if (latestDailyPlanDate && latestDailyPlanDate < todayStr) {
      skippedHistorical.push(`${r.prodId}@${line}(latestDailyPlan=${latestDailyPlanDate})`);
      continue;
    }

    // ── 唯一操作：预占产能槽 ──────────────────────────────────────────────
    // 不更新 lineLastFinish / lineLastItem，让非锁定订单按交期规则自由竞争空闲产能
    for (const [date, qty] of Object.entries(dailyPlan)) {
      const hours = (qty as number) / uph;
      if (hours > 0) capacityPool.allocate(line, date, hours);
    }
  }

  if (skippedHistorical.length > 0) {
    (preOccupyPinnedResults as any)._lastSkipped = skippedHistorical;
  }
}

// 仅用于避免 TS "unused import" 警告（formatDate 供调试时扩展使用）
void formatDate;
