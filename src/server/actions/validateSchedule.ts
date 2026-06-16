/**
 * 排产结果验证 Action
 * 注册为 scheduling:validate
 * 校验排产结果的合理性，输出验证报告
 */
import type { Context } from '@nocobase/actions';

interface Violation {
  prodId?: string;
  line?: string;
  date?: string;
  detail: string;
}

interface CheckResult {
  rule: string;
  name: string;
  pass: boolean;
  violations: Violation[];
}

export async function validateSchedule(ctx: Context) {
  const resultRepo = ctx.db.getRepository('schedule_results_v2');
  const excRepo = ctx.db.getRepository('schedule_exceptions_v2');
  const calRepo = ctx.db.getRepository('md_work_calendars');
  const routeRepo = ctx.db.getRepository('dn_operrouteline');

  // 加载数据
  const results = await resultRepo.find({ paginate: false }) as any[];
  const exceptions = await excRepo.find({ paginate: false }) as any[];
  const calRows = await calRepo.find({ paginate: false }) as any[];
  const routeRows = await routeRepo.find({ paginate: false, filter: { status: 1 } }) as any[];

  // 构建日历 Map: dateStr -> { workHours, isSchedulable }
  const calendarMap = new Map<string, { workHours: number; isSchedulable: boolean }>();
  for (const r of calRows) {
    const d = r.calendarDate ? new Date(r.calendarDate).toISOString().split('T')[0] : null;
    if (d) {
      calendarMap.set(d, { workHours: Number(r.workHours) || 0, isSchedulable: !!r.isSchedulable });
    }
  }

  // 构建路线 Map: itemId -> { uph }
  // dn_operrouteline 字段: item, oper, erpupph, planninglabor, status
  const routeMap = new Map<string, { uph: number }>();
  for (const r of routeRows) {
    const opName = (r.oper || '').toLowerCase();
    const uph = Number(r.erpupph) || 0;
    if (opName.includes('assembly') && uph > 0) {
      routeMap.set(r.item, { uph });
    }
  }

  const checks: CheckResult[] = [];

  // ═══ V1: 每日产量 ≤ UPH × workHours ═══
  {
    const violations: Violation[] = [];
    for (const r of results) {
      if (!r.dailyPlan || !r.uph) continue;
      for (const [date, qty] of Object.entries(r.dailyPlan as Record<string, number>)) {
        const cal = calendarMap.get(date);
        const maxQty = r.uph * (cal?.workHours || 10);
        if (qty > maxQty * 1.01) { // 1% tolerance for rounding
          violations.push({ prodId: r.prodId, date, detail: `产量 ${qty} > 最大 ${maxQty} (UPH=${r.uph} × ${cal?.workHours || 10}h)` });
        }
      }
    }
    checks.push({ rule: 'V1', name: '不超产', pass: violations.length === 0, violations: violations.slice(0, 20) });
  }

  // ═══ V2: 总排产量 = 订单数量 ═══
  {
    const violations: Violation[] = [];
    for (const r of results) {
      if (!r.dailyPlan) continue;
      const planned = Object.values(r.dailyPlan as Record<string, number>).reduce((s: number, v: number) => s + v, 0);
      if (Math.abs(planned - r.totalQty) > 1) { // 1 unit tolerance
        violations.push({ prodId: r.prodId, detail: `排产 ${planned} ≠ 订单 ${r.totalQty}, 差 ${planned - r.totalQty}` });
      }
    }
    checks.push({ rule: 'V2', name: '不漏排/多排', pass: violations.length === 0, violations: violations.slice(0, 20) });
  }

  // ═══ V3: 拆单合理性校验（多线拆单时各线排产量之和 = 订单总量）═══
  {
    const violations: Violation[] = [];
    // 按 prodId 聚合各线的排产量
    const prodLineQty = new Map<string, { lines: Set<string>; totalPlanned: number; orderQty: number }>();
    for (const r of results) {
      if (!prodLineQty.has(r.prodId)) {
        prodLineQty.set(r.prodId, { lines: new Set(), totalPlanned: 0, orderQty: r.totalQty || 0 });
      }
      const entry = prodLineQty.get(r.prodId)!;
      if (r.chosenLine) entry.lines.add(r.chosenLine);
      if (r.dailyPlan) {
        const lineQty = Object.values(r.dailyPlan as Record<string, number>).reduce((s: number, v: number) => s + v, 0);
        entry.totalPlanned += lineQty;
      }
    }
    for (const [prodId, { lines, totalPlanned, orderQty }] of prodLineQty) {
      // 拆单后总量不一致
      if (lines.size > 1 && Math.abs(totalPlanned - orderQty) > 1) {
        violations.push({ prodId, detail: `拆单到 ${lines.size} 条线 (${[...lines].join(', ')})，总排产 ${totalPlanned} ≠ 订单 ${orderQty}` });
      }
    }
    checks.push({ rule: 'V3', name: '拆单合理', pass: violations.length === 0, violations });
  }

  // ═══ V4: 同一线同一天总工时 ≤ 日历工时 ═══
  {
    const violations: Violation[] = [];
    // 累计每线每天的实际使用工时
    const lineDay = new Map<string, number>();
    for (const r of results) {
      if (!r.dailyPlan || !r.chosenLine || !r.uph) continue;
      for (const [date, qty] of Object.entries(r.dailyPlan as Record<string, number>)) {
        const key = `${r.chosenLine}_${date}`;
        lineDay.set(key, (lineDay.get(key) || 0) + (qty as number) / r.uph);
      }
    }
    for (const [key, usedHours] of lineDay) {
      const [line, date] = key.split('_');
      const cal = calendarMap.get(date);
      const maxHours = cal?.workHours || 10;
      if (usedHours > maxHours * 1.01) { // 1% tolerance
        violations.push({ line, date, detail: `使用 ${usedHours.toFixed(1)}h > 日历 ${maxHours}h` });
      }
    }
    checks.push({ rule: 'V4', name: '不超时', pass: violations.length === 0, violations: violations.slice(0, 20) });
  }

  // ═══ V5: 排产日期在日历可排天内 ═══
  {
    const violations: Violation[] = [];
    for (const r of results) {
      if (!r.dailyPlan) continue;
      for (const date of Object.keys(r.dailyPlan as Record<string, number>)) {
        const cal = calendarMap.get(date);
        if (!cal || !cal.isSchedulable) {
          violations.push({ prodId: r.prodId, date, detail: `排在了不可排产日` });
        }
      }
    }
    checks.push({ rule: 'V5', name: '不排休息日', pass: violations.length === 0, violations: violations.slice(0, 20) });
  }

  // ═══ V6: 无碎片排产（日产量 < 10 的条目） ═══
  {
    const violations: Violation[] = [];
    for (const r of results) {
      if (!r.dailyPlan) continue;
      for (const [date, qty] of Object.entries(r.dailyPlan as Record<string, number>)) {
        if (qty < 10 && qty < r.totalQty) { // 总量 < 10 的小单不算碎片
          violations.push({ prodId: r.prodId, date, detail: `日产仅 ${qty} 个 (总量 ${r.totalQty})` });
        }
      }
    }
    checks.push({ rule: 'V6', name: '无碎片排产', pass: violations.length === 0, violations: violations.slice(0, 20) });
  }

  // 汇总
  const allPass = checks.every(c => c.pass);
  const summary = {
    totalResults: results.length,
    totalExceptions: exceptions.length,
    exceptionBreakdown: {} as Record<string, number>,
  };
  for (const e of exceptions) {
    const t = e.exceptionType || 'UNKNOWN';
    summary.exceptionBreakdown[t] = (summary.exceptionBreakdown[t] || 0) + 1;
  }

  ctx.body = {
    valid: allPass,
    summary,
    checks,
  };
}
