/**
 * adjustResult.ts
 *
 * 人工调整排产结果 API
 *
 * 路由：POST /api/scheduling:adjustResult
 *
 * 职责：
 *   1. 接收用户提交的调整参数（产线、日期、每日产量补丁、备注）
 *   2. 验证参数合法性
 *   3. 将调整 merge 到 schedule_results_v2 对应记录
 *   4. 标记 isManualAdjusted=true, adjustedAt=NOW()
 *
 * 注意：
 *   - 调整记录在下次排产时会被覆盖（方案 A）
 *   - dailyPlanPatch 采用 merge 语义，只更新提交的日期，其他日期保留原值
 *   - chosenLine 只允许 ESG 有效产线
 */
import type { Context } from '@nocobase/actions';
export declare function adjustResult(ctx: Context): Promise<void>;
