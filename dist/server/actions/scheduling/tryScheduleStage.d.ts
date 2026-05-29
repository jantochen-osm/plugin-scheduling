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
/** 从 arr 中取 k 个元素的所有组合 */
export declare function getCombinations<T>(arr: T[], k: number): T[][];
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
export declare function tryScheduleStage(mo: any, linesToTry: string[], capacityPool: CapacityPool, allowOvertime: boolean, uph: number, dlvStr: string, today: string, lineLastItem: Record<string, string>, setupTimeHours: number, startFrom?: string): {
    success: boolean;
    remaining: any;
    startDate: string;
    finishDate: string;
    dailyPlans: Record<string, Record<string, number>>;
    extraPlans: Record<string, Record<string, number>>;
    linesUsed: string[];
    costEstimate: {
        standardHours: number;
        overtimeHours: number;
        linesUsedCount: number;
        standardCost: number;
        overtimeCost: number;
        extraLineCost: number;
        totalCost: number;
    };
};
