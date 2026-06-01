/**
 * previewOrders.ts
 *
 * 排产订单预览接口（无副作用，只读查询）。
 *
 * 路由：
 *   POST /api/scheduling:previewOrders
 *
 * Body（均为可选）：
 *   strategy?:     'ESG' | 'EE' | ''  ← 按 osm_category 过滤
 *   dlvDateFrom?:  'YYYY-MM-DD'        ← 交期开始（含）
 *   dlvDateTo?:    'YYYY-MM-DD'        ← 交期结束（含）
 *   keyAccount?:   string              ← 精确匹配客户
 *
 * 返回：
 *   { orders: [...], total: number }
 *
 * 注意：
 *   - 数据库中已预先排除已完成/结束订单，此处不再做状态过滤
 *   - 不执行任何写入操作
 */

import type { Context } from '@nocobase/actions';

export async function previewOrders(ctx: Context) {
  const body = ctx.action?.params?.values ?? ctx.request?.body ?? {};
  const { strategy, dlvDateFrom, dlvDateTo, keyAccount } = body as {
    strategy?: string;
    dlvDateFrom?: string;
    dlvDateTo?: string;
    keyAccount?: string;
  };

  // ── 构建过滤条件 ──────────────────────────────────────────────────
  const filter: Record<string, any> = {};

  // 按策略过滤品类（依赖 osm_category 字段）
  if (strategy && strategy.toUpperCase() !== '') {
    filter.osm_category = strategy.toUpperCase();
  }

  // 按交期范围过滤
  if (dlvDateFrom || dlvDateTo) {
    filter.dlvdate = {};
    if (dlvDateFrom) filter.dlvdate.$gte = dlvDateFrom;
    if (dlvDateTo)   filter.dlvdate.$lte = dlvDateTo;
  }

  // 按客户精确匹配
  if (keyAccount) {
    filter.keyaccount = keyAccount;
  }

  // ── 查询 ──────────────────────────────────────────────────────────
  const repo = ctx.db.getRepository('dn_production_order_ds');
  const rows = (await repo.find({
    paginate: false,
    filter: Object.keys(filter).length > 0 ? filter : undefined,
    sort: ['dlvdate'],   // 按交期升序，与排产优先级一致
  })) as any[];

  // ── 映射字段（与 step1_fetchOrders 保持一致）─────────────────────
  const orders = rows.map((r: any) => ({
    prodId:      r.prodid,
    itemId:      r.itemid,
    qtySched:    Number(r.qtysched) || 0,
    dlvDate:     r.dlvdate instanceof Date
      ? r.dlvdate.toISOString().split('T')[0]
      : r.dlvdate ? String(r.dlvdate).split('T')[0] : '',
    prodStatus:  r.prodstatus,
    prodPoolId:  r.prodpoolid,
    osmCategory: r.osm_category,
    keyAccount:  r.keyaccount || '',
  }));

  ctx.body = {
    orders,
    total: orders.length,
  };
}
