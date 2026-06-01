/**
 * lastRun.ts
 *
 * 返回最近一次排产运行的摘要记录。
 * 路由：GET /api/scheduling:lastRun
 *
 * 直接用 raw SQL 查询，绕过 NocoBase ORM 对 schedule_runs 的字段校验问题
 * （schedule_runs 未注册为标准 NocoBase collection）。
 */

import type { Context } from '@nocobase/actions';

export async function lastRun(ctx: Context) {
  const [rows] = await ctx.db.sequelize.query(
    `SELECT
       "runId", "runTime", status,
       "totalOrders", "validOrders", "scheduledCount", "exceptionCount",
       "successRate", "lineUtilization", "runMode", "selectedProdIds"
     FROM schedule_runs
     ORDER BY "runTime" DESC
     LIMIT 1`,
  );
  ctx.body = { data: rows[0] || null };
}
