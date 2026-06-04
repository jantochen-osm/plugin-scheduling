/**
 * scheduling/postProcess.ts
 *
 * 排产结果后处理。
 *
 * 职责：
 *   1. cleanDailyPlans      — 清理 dailyPlan / dailyPlanDetail 中的零值日期
 *   2. calcLineUtilization  — 计算产线利用率统计
 */

import { CapacityPool } from '../../engines';
import type { LineUtilEntry } from './types';

/**
 * 清理 dailyPlan 与 dailyPlanDetail 中产量为零的日期（如周末、节假日）。
 * 直接修改传入的 results 数组（in-place）。
 *
 * @param results scheduleAll 产出的排产结果数组
 */
export function cleanDailyPlans(results: any[]): void {
  for (const r of results) {
    const dp     = r.dailyPlan     || {};
    const detail = r.dailyPlanDetail || {};

    const cleanPlan:   Record<string, number> = {};
    const cleanDetail: Record<string, any>    = {};

    for (const [d, qty] of Object.entries(dp)) {
      if ((qty as number) > 0) {
        cleanPlan[d] = qty as number;
        if (detail[d]) cleanDetail[d] = detail[d];
      }
    }

    r.dailyPlan       = cleanPlan;
    r.dailyPlanDetail = cleanDetail;
  }
}

/**
 * 计算各产线利用率统计。
 *
 * @param lineCodes    当次排产所有候选产线
 * @param capacityPool 产能池（已完成 allocate 后的状态）
 * @param results      排产结果数组
 * @returns 每条产线的利用率条目数组
 */
export function calcLineUtilization(
  lineCodes: string[],
  capacityPool: CapacityPool,
  results: any[],
): LineUtilEntry[] {
  return lineCodes.map((line) => {
    const totalCap = capacityPool.getMaxLoad(line);
    const used     = capacityPool.getTotalLoad(line);
    return {
      line,
      totalCapacityHours: Math.round(totalCap * 10) / 10,
      usedHours:          Math.round(used * 10) / 10,
      utilizationRate:    totalCap > 0 ? Math.round((used / totalCap) * 1000) / 10 : 0,
      orderCount:         results.filter((r: any) => r.chosenLine === line).length,
    };
  });
}
