/**
 * schedulablePools.ts
 *
 * 订单过滤接口：后端完成 osmCategory 排除 + poolSet 过滤 + 分页。
 * 路由：GET /api/scheduling:schedulablePools
 *
 * 查询参数：
 *   page=1&pageSize=20&sort=dlvdate
 *   filter[dlvdate][$gte]=2026-06-01
 *   filter[dlvdate][$lte]=2026-06-30
 *   filter[keyaccount]=Amazon
 *
 * 响应：
 *   { data: [...], meta: { total, page, pageSize } }
 */

import type { Context } from '@nocobase/actions';

export async function schedulablePools(ctx: Context) {
  const params = ctx.action?.params || {};
  const page = Math.max(Number(params.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(params.pageSize) || 20, 1), 200);
  const sort = params.sort || 'dlvdate';

  // Parse filter: frontend passes JSON string via URL params
  let filter: any = {};
  if (params.filter) {
    filter = typeof params.filter === 'string' ? JSON.parse(params.filter) : params.filter;
  }

  // Build WHERE conditions
  const conditions: string[] = [];
  const replacements: Record<string, any> = {};

  // 1. Exclude EE orders (hardcoded)
  conditions.push(`"osm_category" IS DISTINCT FROM 'EE'`);

  // 2. poolSet filter: only orders in active schedulable_pools
  conditions.push(`"prodpoolid" IN (SELECT "poolId" FROM schedulable_pools WHERE "isActive" = true)`);

  // 3. Apply frontend filter conditions
  let paramIdx = 0;
  for (const [field, value] of Object.entries(filter)) {
    if (value === undefined || value === null || value === '') continue;

    if (field === 'dlvdate') {
      // Handle date range: { $gte: '...', $lte: '...' }
      const dateRange = value as Record<string, any>;
      if (typeof dateRange === 'object') {
        if (dateRange.$gte) {
          paramIdx++;
          conditions.push(`"dlvdate" >= :p${paramIdx}`);
          replacements[`p${paramIdx}`] = dateRange.$gte;
        }
        if (dateRange.$lte) {
          paramIdx++;
          conditions.push(`"dlvdate" <= :p${paramIdx}`);
          replacements[`p${paramIdx}`] = dateRange.$lte;
        }
      }
    } else if (typeof value === 'string') {
      paramIdx++;
      conditions.push(`"${field}" = :p${paramIdx}`);
      replacements[`p${paramIdx}`] = value;
    }
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Whitelist sort fields to prevent SQL injection
  const allowedSortFields = ['dlvdate', 'prodstatus', 'itemid', 'prodid', 'keyaccount', 'qtysched'];
  const sortStr = String(sort);
  const sortField = allowedSortFields.includes(sortStr.replace(/^-/, '')) ? sortStr.replace(/^-/, '') : 'dlvdate';
  const sortDir = sortStr.startsWith('-') ? 'DESC' : 'ASC';

  // Count total
  const [countResult] = await ctx.db.sequelize.query(
    `SELECT COUNT(*) as total FROM dn_production_order_ds ${whereSql}`,
    { replacements },
  );
  const total = Number((countResult[0] as any)?.total || 0);

  // Fetch page
  const offset = (page - 1) * pageSize;
  const [rows] = await ctx.db.sequelize.query(
    `SELECT "prodid", "itemid", "qtysched", "dlvdate", "prodstatus", "prodpoolid", "osm_category", "keyaccount", "project"
     FROM dn_production_order_ds
     ${whereSql}
     ORDER BY "${sortField}" ${sortDir}
     LIMIT :limit OFFSET :offset`,
    { replacements: { ...replacements, limit: pageSize, offset } },
  );

  ctx.body = {
    data: rows,
    meta: {
      total,
      page,
      pageSize,
    },
  };
}
