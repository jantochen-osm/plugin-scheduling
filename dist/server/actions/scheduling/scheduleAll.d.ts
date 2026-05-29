/**
 * scheduling/scheduleAll.ts
 *
 * 核心排产循环。
 *
 * 对每一个订单，依次执行：
 *   1. 获取允许产线（customer_line_mapping → fallbackLines）
 *   2. 查询 UPH（dn_operrouteline）
 *   3. 对候选产线评分排名（产能 / 换型亲和 / 负载均衡）
 *   4. 枚举 [人手倍率 1x→2x] × [不加班→加班] × [单线→多线] 的组合，
 *      用 calcLatestStart + tryScheduleStage 找到最优方案（bestResult）
 *   5. 若当前单仍逾期，回溯尝试对前序订单翻倍人手，更早释放产线
 *   6. 提交 bestResult，更新产能池 & lineLastFinish 顺序约束
 *
 * 人手翻倍逻辑（headcountMult）：
 *   - 每次翻倍以 2x 为单位（UPH × 2），最多 1 次（maxHeadcountMult=2）
 *   - 翻倍人手时不叠加多线（双倍人手 ≈ 双线，避免指数级组合）
 *   - 回溯翻倍：当前单仍逾期时，对前序已提交订单翻倍人手，加快完成，
 *               早日释放产线，再重试当前单
 */
import type { Context } from '@nocobase/actions';
import { RuleEngine, CapacityPool } from '../../engines';
import type { SchedulingStrategy } from '../strategies';
export declare function scheduleAll(sortedOrders: any[], ruleEngine: RuleEngine, lineCodes: string[], capacityPool: CapacityPool, ctx: Context, strategy: SchedulingStrategy): Promise<{
    results: any[];
    exceptions: any[];
    lineUtilization: {
        line: string;
        totalCapacityHours: number;
        usedHours: number;
        utilizationRate: number;
        orderCount: number;
    }[];
}>;
