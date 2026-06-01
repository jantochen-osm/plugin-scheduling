/**
 * removeResults.ts
 *
 * 删除指定订单的排产结果（仅删 schedule_results_v2，不影响其他订单）。
 *
 * 路由：POST /api/scheduling:removeResults
 * Body：{ prodIds: string[] }   ← 至少传 1 个
 *
 * 典型场景：追加模式下误选了某订单，通过此接口从排产结果中撤销。
 */
import type { Context } from '@nocobase/actions';
export declare function removeResults(ctx: Context): Promise<void>;
