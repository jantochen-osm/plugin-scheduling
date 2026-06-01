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
export declare function previewOrders(ctx: Context): Promise<void>;
