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

export async function removeResults(ctx: Context) {
  const body = ctx.action?.params?.values ?? ctx.request?.body ?? {};
  const prodIds: string[] = body.prodIds;

  if (!Array.isArray(prodIds) || prodIds.length === 0) {
    ctx.throw(400, 'prodIds is required and must be a non-empty array');
  }

  const [, meta] = await ctx.db.sequelize.query(
    `DELETE FROM schedule_results_v2 WHERE "prodId" IN (:prodIds)`,
    { replacements: { prodIds } },
  );

  const deleted = (meta as any)?.rowCount ?? prodIds.length;
  ctx.logger?.info?.(`[removeResults] Deleted ${deleted} rows for prodIds: ${prodIds.join(', ')}`);

  ctx.body = {
    success: true,
    deleted,
    prodIds,
  };
}
