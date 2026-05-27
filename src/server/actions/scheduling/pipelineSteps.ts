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

import { Context } from '@nocobase/server';
import { RuleEngine, CapacityPool } from '../../engines';
import type { SchedulingStrategy } from '../strategies';
import { formatDate, addDays, getToday, getTodayStr, SCHEDULING_CONFIG } from './config';

// ── Step 1: 拉取订单 ────────────────────────────────────────────────
export async function step1_fetchOrders(ctx: Context) {
  const repo = ctx.db.getRepository('dn_production_order_ds');
  const rows = (await repo.find({ paginate: false })) as any[];
  return rows.map((r: any) => ({
    prodId: r.prodid,
    itemId: r.itemid,
    qtySched: Number(r.qtysched) || 0,
    // 统一归一化为 'YYYY-MM-DD'，避免 UTC 时区 off-by-one
    dlvDate: r.dlvdate instanceof Date
      ? r.dlvdate.toISOString().split('T')[0]
      : r.dlvdate ? String(r.dlvdate).split('T')[0] : '',
    prodStatus: r.prodstatus,
    prodPoolId: r.prodpoolid,
    osmCategory: r.osm_category,
    keyAccount: r.keyaccount || '',
  }));
}

// ── Step 2: 校验 & 富化 ─────────────────────────────────────────────
/**
 * 过滤规则（任一触发 → 进入 exceptions，不排产）：
 *   - dlvDate 为空
 *   - dlvDate < today（已逾期）
 *   - qtySched ≤ 0
 *   - ESG 订单缺少 keyAccount
 *   - dn_operrouteline 无该产品路线
 *
 * 通过校验的订单附加 `_stages: [{ stageName: 'Assembly', stageSequence: 1 }]`
 */
export async function step2_validateAndEnrich(orders: any[], ctx: Context) {
  const valid: any[] = [];
  const exceptions: any[] = [];
  const today = getToday();
  today.setHours(0, 0, 0, 0);

  for (const mo of orders) {
    if (!mo.dlvDate) {
      exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: 'MISSING_DLV_DATE', severity: 'BLOCKER', message: 'DlvDate is empty' });
      continue;
    }
    if (new Date(mo.dlvDate) < today) {
      exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: 'PAST_DLV_DATE', severity: 'BLOCKER', message: `DlvDate=${mo.dlvDate} past due` });
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
 * 若无任何映射则退回策略 fallbackLines。
 */
export async function step4_collectLines(
  orders: any[],
  ruleEngine: RuleEngine,
  strategy: SchedulingStrategy,
): Promise<string[]> {
  const lineSet = new Set<string>();
  for (const mo of orders) {
    if (mo.keyAccount) {
      const mapping = await ruleEngine.getCustomerLines(mo.keyAccount);
      if (mapping) {
        for (const line of mapping.assignedLines) lineSet.add(line);
      }
    }
  }
  if (lineSet.size === 0) {
    strategy.getFallbackLines().forEach((l) => lineSet.add(l));
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
