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

  // ── 批量查询实际累计完成量（动态扣减，与 step1_fetchOrders 逻辑一致）──────
  // 来源：dn_esg_assebmly_production_report.totalgoodqty（每日良品数 SUM）
  // 关联：mo = dn_production_order_ds.prodid
  const prodIds = (rows as any[]).map((r: any) => r.prodid).filter(Boolean);
  const actualQtyMap = new Map<string, number>();
  if (prodIds.length > 0) {
    try {
      const [actualRows] = await ctx.db.sequelize.query(
        `SELECT mo                             AS prod_id,
                COALESCE(SUM(totalgoodqty), 0) AS qty_actual
         FROM   dn_esg_assebmly_production_report
         WHERE  mo IN (:prodIds)
         GROUP  BY mo`,
        { replacements: { prodIds } },
      ) as any;
      for (const r of (actualRows || [])) {
        actualQtyMap.set(String(r.prod_id), Number(r.qty_actual) || 0);
      }
    } catch (e: any) {
      // 查询失败降级：qtyActual=0，不影响主流程（订单列表正常返回）
      ctx.logger?.warn?.('[schedulablePools] fetchActualQty failed: ' + (e?.message || String(e)));
    }
  }

  // 合并实际完成量到返回数据
  const enrichedRows = (rows as any[]).map((r: any) => {
    const qtySched      = Number(r.qtysched) || 0;
    const qtyActual     = actualQtyMap.get(String(r.prodid)) ?? 0;
    const qtyRemaining  = Math.max(0, qtySched - qtyActual);
    const completionRate = qtySched > 0
      ? Math.min(100, Math.round(qtyActual / qtySched * 100))
      : 0;
    return { ...r, qtyActual, qtyRemaining, completionRate };
  });

  ctx.body = {
    data: enrichedRows,
    meta: {
      total,
      page,
      pageSize,
    },
  };
}
