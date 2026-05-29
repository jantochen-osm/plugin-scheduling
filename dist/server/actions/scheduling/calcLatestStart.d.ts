/**
 * scheduling/calcLatestStart.ts
 *
 * JIT 后拉式起始日计算：
 *   给定一条产线、交期和所需工时，从交期向前扫描，
 *   找到"最晚可行的连续起始日"，保证订单能在无断点的
 *   连续工作日内完成生产。
 */
import { CapacityPool } from '../../engines';
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
export declare function calcLatestStart(capacityPool: CapacityPool, linesToTry: string[], uph: number, totalQty: number, setupHours: number, dlvStr: string, earliestStart: string, enforceContiguity?: boolean): string;
