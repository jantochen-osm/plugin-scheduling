/**
 * scheduling/commitResult.ts
 *
 * 将 bestResult 写入产能池，构建排产结果记录。
 *
 * 职责：
 *   1. 尾单合并（末日产量过低时并入前一日）
 *   2. 重新 allocate 产能（tryScheduleStage 已 rollback，此处正式占用）
 *   3. 构建 dailyPlanDetail（每日排产计算构成明细）
 *   4. 更新产线状态（lineLastItem / lineLoad / lineLastFinish）
 *   5. 构建并返回 result 记录数组
 */

import { CapacityPool } from '../../engines';
import type { SchedulingStrategy } from '../strategies';
import { SCHEDULING_CONFIG } from './config';

/**
 * 提交最优排产方案到产能池，返回本次提交的 result 记录数组。
 *
 * @param mo              当前订单
 * @param bestResult      tryScheduleStage 产出的最优方案
 * @param allowedLines    该订单允许的候选产线列表
 * @param stageName       当前工段名称
 * @param routeUph        工艺路线标准 UPH（存入 DB，不随人数变化）
 * @param effectiveUph    实际有效 UPH（= erpupph × 实际人数，用于产能分配）
 * @param headcount       标准开工人数（存入 DB）
 * @param actualHeadcount 实际开工人数（含增人，用于 dailyPlanDetail 展示）
 * @param dlvStr          交期字符串（YYYY-MM-DD）
 * @param today           今日字符串（YYYY-MM-DD）
 * @param lineLastItem    各产线最后物料字典（本函数更新）
 * @param lineLoad        各产线累计负载（本函数更新）
 * @param lineLastFinish  各产线最后完成日期（本函数更新）
 * @param capacityPool    产能池（本函数 allocate）
 * @param cfg             策略配置
 */
export function commitBestResult(
  mo: any,
  bestResult: any,
  allowedLines: string[],
  stageName: string,
  routeUph: number,
  effectiveUph: number,
  headcount: number,
  actualHeadcount: number,
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

    // 构建 dailyPlanDetail（计算构成明细）
    const perPersonUph = headcount > 0 ? routeUph / headcount : 0;
    const detailMap: Record<string, any> = {};

    // 正式分配产能（tryScheduleStage 已 rollback，此处重新 allocate）
    // 注意：使用 effectiveUph 计算工时（含人数倍增的实际产能）
    for (const dateStr of Object.keys(dp).sort()) {
      const qty = dp[dateStr];
      const setupH = isFirstDay ? lineSetupHours : 0;
      isFirstDay = false;
      const extraQty = ep[dateStr] || 0;
      const standardQty = Math.max(0, qty - extraQty);
      const totalH = setupH + standardQty / effectiveUph;
      capacityPool.allocate(
        line,
        dateStr,
        Math.min(totalH, capacityPool.getAvailableHours(line, dateStr) + (setupH || 0)),
      );

      // 每日排产计算构成
      const dayInfo = capacityPool.getDayInfo(dateStr);
      detailMap[dateStr] = {
        totalQty: qty,
        standardQty,
        overtimeQty: extraQty,
        baseWorkHours: dayInfo.baseWorkHours,
        overtimeHours: effectiveUph > 0 ? Math.round((extraQty / effectiveUph) * 100) / 100 : 0,
        setupHours: setupH,
        effectiveHours: effectiveUph > 0
          ? Math.round(((standardQty / effectiveUph) + setupH) * 100) / 100
          : 0,
        uph: routeUph,
        perPersonUph: Math.round(perPersonUph * 100) / 100,
        headcount,
        actualHeadcount,
        effectiveUph: Math.round(effectiveUph * 100) / 100,
        dayType: qty > 0 && extraQty > 0 ? 'OVERTIME' : dayInfo.dayType,
        dayLabel: dayInfo.dayLabel,
      };

      lineQty += qty;
      if (!lineStart || dateStr < lineStart) lineStart = dateStr;
      if (!lineFinish || dateStr > lineFinish) lineFinish = dateStr;
    }

    // 更新产线状态
    lineLastItem[line] = mo.itemId;
    lineLoad[line] = (lineLoad[line] || 0) + lineQty / effectiveUph + lineSetupHours;
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
      uph: routeUph,    // DB 存工艺路线标准值（不随人数变化）
      headcount,        // DB 存标准基础人力（增加的人力只体现在 dailyPlan 数量上）
      // ── 动态扣减快照字段（排产时锁定，用于甘特图进度条展示）──────────
      qtySched:       mo.qtySched       ?? null,  // 原始计划总量快照
      qtyActual:      mo.qtyActual      ?? 0,      // 已完成良品数快照
      completionRate: mo.completionRate ?? 0,      // 完成率 % 快照 (0-100)
      // ─────────────────────────────────────────────────────────────────
      dailyPlan: dp,
      dailyPlanDetail: detailMap,  // 每日排产计算构成
      extraCapacityPlan: Object.keys(ep).length > 0 ? ep : null,
      setupTimeUsed: lineSetupHours,
      costEstimate: bestResult.costEstimate,
      earlyStartDays: (bestResult as any)?._earlyDays ?? 0,     // 实际提前天数（0=JIT）
      isEarlyStart: ((bestResult as any)?._earlyDays ?? 0) > 0, // 是否提前开工
      isOvertime: (bestResult as any)?._allowOT ?? false,        // 是否使用加班
      stage: stageName,
    });
  }

  return committed;
}
