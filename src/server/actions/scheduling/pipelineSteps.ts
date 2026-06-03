/**
 * scheduling/pipelineSteps.ts
 *
 * 排产流水线的五个预处理步骤：
 *   Step 1 — 从数据库拉取所有生产订单
 *   Step 2 — 校验 & 富化（过滤无效单、附加工段信息）
 *   Step 3 — 排序（交期优先 + 聚类窗口）
 *   Step 4 — 收集候选产线（客户映射 + 策略兜底）
 *   Step 5 — 初始化产能池（CapacityPool）
 */

import type { Context } from '@nocobase/actions';
import { RuleEngine, CapacityPool } from '../../engines';
import type { SchedulingStrategy } from '../strategies';
import { formatDate, addDays, getToday, getTodayStr, SCHEDULING_CONFIG } from './config';

// ── Step 1: 拉取订单 ────────────────────────────────────────────────
/**
 * 从 dn_production_order_ds 拉取订单。
 * @param prodIds  指定订单 ID 列表（prodid 字段）；不传或空数组 = 全量
 */
export async function step1_fetchOrders(ctx: Context, prodIds?: string[]) {
  const repo = ctx.db.getRepository('dn_production_order_ds');
  const filter: any = prodIds && prodIds.length > 0
    ? { prodid: { $in: prodIds } }   // 指定订单
    : {};                             // 全量（兜底，不传 prodIds 时）
  const rows = (await repo.find({ paginate: false, filter })) as any[];
  return rows.map((r: any) => ({
    prodId: r.prodid,
    itemId: r.itemid,
    qtySched: Number(r.qtysched) || 0,
    // 使用本地时区 formatDate，避免 UTC+8 环境下 toISOString 导致日期偏移 -1 天
    // 例：2026-06-05T00:00:00+08:00 → toISOString = 2026-06-04T16:00Z → 错误地解析为 06/04
    dlvDate: r.dlvdate instanceof Date
      ? formatDate(r.dlvdate)               // 使用本地日期格式化
      : r.dlvdate ? String(r.dlvdate).split('T')[0] : '',
    prodStatus: r.prodstatus,
    prodPoolId: r.prodpoolid,
    osmCategory: r.osm_category,
    keyAccount: r.keyaccount || '',
  }));
}

// ── Step 2: 校验 & 富化 ─────────────────────────────────────────────
/**
 * 校验规则（BLOCKER → 进入 exceptions，不排产）：
 *   - dlvDate 为空                              → MISSING_DLV_DATE  BLOCKER
 *   - qtySched ≤ 0                             → INVALID_QTY       BLOCKER
 *   - ESG 订单缺少 keyAccount                  → MISSING_KEY_ACCT  BLOCKER
 *   - dn_operrouteline 无该产品路线            → NO_ROUTE          BLOCKER
 *
 * WARNING（记录但仍参与排产）：
 *   - dlvDate < today（逾期）                  → PAST_DLV_DATE     WARNING
 *     逾期订单在 step3 中获得最高优先级（overdueDays 降序第 1 排序键）
 *
 * 通过校验的订单附加 `_stages: [{ stageName: 'Assembly', stageSequence: 1 }]`
 */
export async function step2_validateAndEnrich(orders: any[], ctx: Context) {
  const valid: any[] = [];
  const exceptions: any[] = [];
  const today = getToday();
  today.setHours(0, 0, 0, 0);

  for (const mo of orders) {
    // ── BLOCKER 校验 ──────────────────────────────────────────────────
    if (!mo.dlvDate) {
      exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: 'MISSING_DLV_DATE', severity: 'BLOCKER', message: 'DlvDate is empty' });
      continue;
    }
    if (mo.qtySched <= 0) {
      exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: 'INVALID_QTY', severity: 'BLOCKER', message: `QtySched=${mo.qtySched}` });
      continue;
    }
    if (mo.osmCategory === 'ESG' && !mo.keyAccount) {
      exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: 'MISSING_KEY_ACCOUNT', severity: 'BLOCKER', message: 'ESG order missing keyAccount' });
      continue;
    }

    const routeRepo = ctx.db.getRepository('dn_operrouteline');
    const hasRoute = await routeRepo.count({ filter: { item: mo.itemId, status: 1 } });
    if (!hasRoute) {
      exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: 'NO_ROUTE', severity: 'BLOCKER', message: `No route for ${mo.itemId}` });
      continue;
    }

    // ── WARNING 校验（记录但不阻断，订单仍参与排产）───────────────────
    if (new Date(mo.dlvDate) < today) {
      exceptions.push({
        prodId: mo.prodId, itemId: mo.itemId,
        exceptionType: 'PAST_DLV_DATE',
        severity: 'WARNING',
        message: `DlvDate=${mo.dlvDate} past due, scheduled with highest priority`,
      });
      // 不 continue — 逾期订单仍进入排产，step3 会按 overdueDays 降序给予最高优先级
    }

    valid.push({ ...mo, _stages: [{ stageName: 'Assembly', stageSequence: 1 }] });
  }

  return { validOrders: valid, exceptions };
}

// ── Step 3: 排序 ────────────────────────────────────────────────────
/**
 * 四级排序键（优先级从高到低）：
 *   1. overdueDays 降序（已逾期天数越多越紧急）
 *   2. _windowIdx 升序（clusterWindowDays 天为一窗，交期早的窗口优先）
 *   3. itemId 字母升序（同窗口内同品号聚集，减少换型）
 *   4. dlvDate 升序（同品号内交期早的先排）
 */
export function step3_sort(orders: any[]) {
  const windowDays = SCHEDULING_CONFIG.clusterWindowDays;
  const today = getToday();
  today.setHours(0, 0, 0, 0);

  const enriched = orders.map((o) => {
    const dlvTime = new Date(o.dlvDate).getTime();
    const overdueMs = today.getTime() - dlvTime;
    const overdueDays = overdueMs > 0 ? Math.ceil(overdueMs / 86400000) : 0;
    return { ...o, _dlvTime: dlvTime, overdueDays };
  });

  enriched.sort((a, b) => a._dlvTime - b._dlvTime);
  const baseTime = enriched.length > 0 ? enriched[0]._dlvTime : 0;
  const windowMs = windowDays * 86400000;
  for (const o of enriched) {
    o._windowIdx = Math.floor((o._dlvTime - baseTime) / windowMs);
  }

  return enriched.sort((a, b) => {
    if (a.overdueDays !== b.overdueDays) return b.overdueDays - a.overdueDays;
    if (a._windowIdx !== b._windowIdx) return a._windowIdx - b._windowIdx;
    if (a.itemId !== b.itemId) return a.itemId < b.itemId ? -1 : 1;
    return a._dlvTime - b._dlvTime;
  });
}

// ── Step 4: 收集候选产线 ────────────────────────────────────────────
/**
 * 从 customer_line_mapping 收集所有本次排产涉及的产线；
 * 同时合并策略 fallbackLines，确保物料前缀路由等非客户映射产线也被纳入产能池。
 */
export async function step4_collectLines(
  orders: any[],
  ruleEngine: RuleEngine,
  strategy: SchedulingStrategy,
): Promise<string[]> {
  const lineSet = new Set<string>();

  // 1. 从 customer_line_mapping 收集
  for (const mo of orders) {
    if (mo.keyAccount) {
      const mapping = await ruleEngine.getCustomerLines(mo.keyAccount);
      if (mapping) {
        for (const line of mapping.assignedLines) lineSet.add(line);
      }
    }
  }

  // 2. 始终合并 fallbackLines（如 ESG 4F2 可能来自物料前缀路由而非客户映射）
  for (const line of strategy.getFallbackLines()) {
    lineSet.add(line);
  }

  return [...lineSet].sort();
}

// ── Step 5: 初始化产能池 ─────────────────────────────────────────────
export async function step5_initCapacityPool(
  ctx: Context,
  ruleEngine: RuleEngine,
  lineCodes: string[],
): Promise<CapacityPool> {
  const pool = new CapacityPool(ruleEngine, SCHEDULING_CONFIG.defaultWorkHours);
  const today = getTodayStr();
  const endDate = addDays(today, SCHEDULING_CONFIG.maxDays);
  await pool.init(lineCodes, today, endDate);
  return pool;
}
