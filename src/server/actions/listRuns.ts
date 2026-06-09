/**
 * listRuns.ts
 *
 * 返回排产运行历史记录（分页）。
 * 路由：GET /api/scheduling:listRuns?page=1&pageSize=10
 *
 * 直接用 raw SQL 查询，绕过 NocoBase ORM 对 schedule_runs 的字段校验问题。
 */

import type { Context } from '@nocobase/actions';

export async function listRuns(ctx: Context) {
  const { page = 1, pageSize = 10 } = ctx.action?.params ?? {};
  const limit  = Math.min(Number(pageSize) || 10, 100);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

  const [rows] = await ctx.db.sequelize.query(
    `SELECT
       "runId", "runTime", status,
       "totalOrders", "validOrders", "scheduledCount", "exceptionCount",
       "successRate", "runMode", "selectedProdIds", "exceptionBreakdown",
       strategy, "startDate", "versionName"
     FROM schedule_runs
     ORDER BY "runTime" DESC
     LIMIT :limit OFFSET :offset`,
    { replacements: { limit, offset } },
  );

  const [[{ total }]] = await ctx.db.sequelize.query(
    `SELECT COUNT(*) AS total FROM schedule_runs`,
  ) as any;

  ctx.body = {
    data: rows,
    meta: {
      total: Number(total),
      page: Number(page),
      pageSize: limit,
    },
  };
}
