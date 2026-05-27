/**
 * scheduling/calcLatestStart.ts
 *
 * JIT 后拉式起始日计算：
 *   给定一条产线、交期和所需工时，从交期向前扫描，
 *   找到"最晚可行的连续起始日"，保证订单能在无断点的
 *   连续工作日内完成生产。
 */

import { CapacityPool } from '../../engines';
import { formatDate } from './config';

/**
 * 计算订单的最晚可行起始日（JIT 后拉）。
 *
 * 连续性规则：
 *   - 非工作日（baseHours = 0）：跳过，不重置累计量
 *     （tryScheduleStage 也会自然跳过这些日期）
 *   - 工作日且产能已被他单占满（avail = 0，baseHours > 0）：
 *     生产断点，重置累计量，不允许跨越此断点
 *
 * @param capacityPool  产能池
 * @param linesToTry    候选产线列表（只用 [0] 主产线计算）
 * @param uph           每小时产量
 * @param totalQty      订单数量
 * @param setupHours    换型时间（小时）
 * @param dlvStr        交期（作为扫描上限）
 * @param earliestStart 最早可开始日（下限）
 * @param enforceContiguity  是否强制连续性（默认 true）
 * @returns 最晚可行起始日字符串（YYYY-MM-DD）
 */
export function calcLatestStart(
  capacityPool: CapacityPool,
  linesToTry: string[],
  uph: number,
  totalQty: number,
  setupHours: number,
  dlvStr: string,
  earliestStart: string,
  enforceContiguity = true,
): string {
  const hoursNeeded = totalQty / uph + setupHours;

  // 升序构建日期列表 [earliestStart .. dlvStr]
  const dates: string[] = [];
  const cur = new Date(earliestStart);
  const end = new Date(dlvStr);
  while (cur <= end) {
    dates.push(formatDate(cur));
    cur.setDate(cur.getDate() + 1);
  }

  if (enforceContiguity) {
    // 从 dlvStr 向前扫描，寻找最晚的连续起始日
    const primaryLine = linesToTry[0];
    let accumulated = 0;

    for (let i = dates.length - 1; i >= 0; i--) {
      const baseHours = capacityPool.getWorkHoursForDate(dates[i]);
      const avail = capacityPool.getAvailableHours(primaryLine, dates[i]);

      if (baseHours <= 0) {
        // 非工作日（周末/假期）：跳过，不重置
        continue;
      }
      if (avail <= 0) {
        // 工作日但产能被他单占满：生产断点，重置累计
        accumulated = 0;
        continue;
      }

      accumulated += avail;
      if (accumulated >= hoursNeeded) {
        return dates[i]; // 找到最晚可行的连续起始日
      }
    }

    // 找不到足够的连续窗口，回退到 earliestStart
    return earliestStart;
  }

  // 非连续模式（兼容旧逻辑，不推荐使用）
  const descDates = [...dates].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
  let accumulatedHours = 0;
  let latestStart = earliestStart;
  for (const dateStr of descDates) {
    for (const line of linesToTry) {
      accumulatedHours += capacityPool.getAvailableHours(line, dateStr);
    }
    latestStart = dateStr;
    if (accumulatedHours >= hoursNeeded) break;
  }
  return latestStart;
}
