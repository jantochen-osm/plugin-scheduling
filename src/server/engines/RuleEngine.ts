/**
 * Sprint 1 — RuleEngine
 *
 * 职责：从 collection 中查询排产规则，提供带缓存的查询接口。
 *
 * 查询方法：
 *   getCustomerLines(keyAccount)          → 客户→分配产线
 *   getCalendarException(date)            → 日期异常规则
 *   getLineSelectWeights()                → 选线权重配置
 *
 * 缓存策略：
 *   - 首次查询时全量加载到内存 Map
 *   - invalidateCache() 强制刷新
 */

import type { Context } from '@nocobase/actions';

// ─── 类型定义 ───

export interface CustomerLineResult {
  keyAccount: string;
  osmCategory: string;
  assignedLines: string[];
}

export interface CalendarException {
  exceptionDate: string; // 'YYYY-MM-DD'
  exceptionType: 'MAINTENANCE' | 'CHANGEOVER' | 'EXTRA_WORKDAY';
  affectedLines: string[] | null; // null = 全线
  workHours: number; // MAINTENANCE: 保养后剩余工时；EXTRA_WORKDAY: 补班日可用工时
  setupTime: number; // 换线耗时（分钟），CHANGEOVER 专用
  remarks?: string;
}

export interface WorkCalendarDay {
  calendarDate: string; // 'YYYY-MM-DD'
  isWorkday: boolean;
  isSchedulable: boolean;
  workHours: number;
  dayOfWeek: number;
}

export interface LineSelectWeights {
  capacity: number;
  setupAffinity: number;
  loadBalance: number;
}

export interface SchedulablePool {
  poolId: string;
  poolName: string;
  osmCategory: string; // 'EE' | 'ESG' | 'ALL'
  isActive: boolean;
}

export interface ESGRoutingRule {
  ruleName: string;
  ruleType: 'PRODID' | 'PREFIX';
  condition: string;
  lines: string[];
  sort: number;
  isActive: boolean;
}

// ─── Engine 类 ───

export class RuleEngine {
  private ctx: Context;

  // 缓存
  private customerLineCache: Map<string, CustomerLineResult> | null = null;
  private calendarExceptionCache: Map<string, CalendarException> | null = null;
  private workCalendarCache: Map<string, WorkCalendarDay> | null = null;
  private schedulablePoolCache: Map<string, SchedulablePool> | null = null;
  private esgRoutingRules: ESGRoutingRule[] | null = null;
  private weights: LineSelectWeights;

  constructor(ctx: Context, weights?: Partial<LineSelectWeights>) {
    this.ctx = ctx;
    this.weights = {
      capacity: weights?.capacity ?? 0.3,
      setupAffinity: weights?.setupAffinity ?? 0.5,
      loadBalance: weights?.loadBalance ?? 0.2,
    };
  }

  // ─── 公开查询方法 ───

  /** 获取客户分配的产线 */
  async getCustomerLines(keyAccount: string): Promise<CustomerLineResult | null> {
    await this.ensureCustomerLineCache();
    return this.customerLineCache!.get(keyAccount) ?? null;
  }

  /** 获取指定日期的日历异常（null = 无异常） */
  async getCalendarException(date: string): Promise<CalendarException | null> {
    await this.ensureCalendarExceptionCache();
    return this.calendarExceptionCache!.get(date) ?? null;
  }

  /** 获取指定日期的工作日历（产线无关的基础日历） */
  async getWorkCalendarDay(date: string): Promise<WorkCalendarDay | null> {
    await this.ensureWorkCalendarCache();
    return this.workCalendarCache!.get(date) ?? null;
  }

  /** 获取选线权重 */
  getLineSelectWeights(): LineSelectWeights {
    return { ...this.weights };
  }

  /**
   * 获取可排产订单池列表
   * @param osmCategory 按品类过滤（EE / ESG）；不传则返回全部
   */
  async getSchedulablePools(osmCategory?: string): Promise<SchedulablePool[]> {
    await this.ensureSchedulablePoolCache();
    const all = [...this.schedulablePoolCache!.values()].filter(p => p.isActive);
    if (!osmCategory) return all;
    return all.filter(p => p.osmCategory === osmCategory || p.osmCategory === 'ALL');
  }

  /**
   * 解析 ESG 订单的产线路由
   * 优先级：PRODID（单号精确匹配）> PREFIX（物料前缀）> CUSTOMER（客户映射）> fallback
   */
  async resolveESGLines(keyAccount: string, itemId: string, prodId: string): Promise<string[]> {
    await this.ensureESGRoutingCache();
    for (const rule of this.esgRoutingRules!) {
      if (!rule.isActive) continue;
      if (rule.ruleType === 'PRODID' && prodId === rule.condition) {
        return [...rule.lines];
      }
      if (rule.ruleType === 'PREFIX' && itemId.toUpperCase().startsWith(rule.condition.toUpperCase())) {
        return [...rule.lines];
      }
    }
    // 查 customer_line_mapping
    if (keyAccount) {
      const mapping = await this.getCustomerLines(keyAccount);
      if (mapping && mapping.assignedLines.length > 0) {
        return [...mapping.assignedLines];
      }
    }
    return this.getESGFallbackLines();
  }

  /**
   * 批量预计算 ESG 产线路由（排产循环前调用一次）
   * @returns Map<prodId, lines>，循环内直接查 Map，无需重复匹配
   */
  async precomputeESGRouting(orders: any[]): Promise<Map<string, string[]>> {
    await this.ensureESGRoutingCache();
    await this.ensureCustomerLineCache(); // 预加载客户映射缓存
    const result = new Map<string, string[]>();
    for (const mo of orders) {
      const lines = await this.resolveESGLines(mo.keyAccount, mo.itemId, mo.prodId);
      result.set(mo.prodId, lines);
    }
    return result;
  }

  /** ESG 兜底产线 */
  getESGFallbackLines(): string[] {
    return ['4F1', '4F2', '4F4', '4F6'];
  }

  /** 强制刷新所有缓存 */
  invalidateCache(): void {
    this.customerLineCache = null;
    this.calendarExceptionCache = null;
    this.workCalendarCache = null;
    this.schedulablePoolCache = null;
    this.esgRoutingRules = null;
  }

  // ─── 内部加载方法 ───

  private async ensureCustomerLineCache(): Promise<void> {
    if (this.customerLineCache !== null) return;
    const repo = this.ctx.db.getRepository('customer_line_mapping');
    const rows = (await repo.find({ paginate: false })) as any[];

    this.customerLineCache = new Map();
    for (const r of rows) {
      this.customerLineCache.set(r.keyAccount, {
        keyAccount: r.keyAccount,
        osmCategory: r.osmCategory,
        assignedLines: Array.isArray(r.assignedLines) ? r.assignedLines : [],
      });
    }
  }

  private async ensureCalendarExceptionCache(): Promise<void> {
    if (this.calendarExceptionCache !== null) return;
    const repo = this.ctx.db.getRepository('calendar_exceptions');
    const rows = (await repo.find({ paginate: false })) as any[];

    this.calendarExceptionCache = new Map();
    for (const r of rows) {
      const dateStr =
        r.exceptionDate instanceof Date
          ? `${r.exceptionDate.getFullYear()}-${String(r.exceptionDate.getMonth()+1).padStart(2,'0')}-${String(r.exceptionDate.getDate()).padStart(2,'0')}`
          : String(r.exceptionDate).split('T')[0];
      this.calendarExceptionCache.set(dateStr, {
        exceptionDate: dateStr,
        exceptionType: r.exceptionType,
        affectedLines: r.affectedLines ?? null,
        workHours: Number(r.workHours) ?? 0,
        setupTime: Number(r.setupTime) ?? 0,
        remarks: r.remarks,
      });
    }
  }

  private async ensureWorkCalendarCache(): Promise<void> {
    if (this.workCalendarCache !== null) return;
    const repo = this.ctx.db.getRepository('md_work_calendars');
    const rows = (await repo.find({ paginate: false })) as any[];

    this.workCalendarCache = new Map();
    for (const r of rows) {
      const dateStr =
        r.calendarDate instanceof Date
          ? `${r.calendarDate.getFullYear()}-${String(r.calendarDate.getMonth()+1).padStart(2,'0')}-${String(r.calendarDate.getDate()).padStart(2,'0')}`
          : String(r.calendarDate || '').split('T')[0];
      if (!dateStr) continue;
      this.workCalendarCache.set(dateStr, {
        calendarDate: dateStr,
        isWorkday: !!r.isWorkday,
        isSchedulable: !!r.isSchedulable,
        workHours: Number(r.workHours) || 0,
        dayOfWeek: Number(r.dayOfWeek) || 0,
      });
    }
  }

  private async ensureSchedulablePoolCache(): Promise<void> {
    if (this.schedulablePoolCache !== null) return;
    const repo = this.ctx.db.getRepository('schedulable_pools');
    const rows = (await repo.find({ paginate: false })) as any[];
    this.schedulablePoolCache = new Map();
    for (const r of rows) {
      this.schedulablePoolCache.set(r.poolId, {
        poolId: r.poolId,
        poolName: r.poolName || '',
        osmCategory: r.osmCategory || 'ALL',
        isActive: r.isActive !== false,
      });
    }
  }

  private async ensureESGRoutingCache(): Promise<void> {
    if (this.esgRoutingRules !== null) return;
    const repo = this.ctx.db.getRepository('esg_line_routing');
    const rows = (await repo.find({ paginate: false, sort: ['sort'] })) as any[];
    this.esgRoutingRules = rows.map((r) => ({
      ruleName: r.ruleName || '',
      ruleType: r.ruleType,
      condition: r.condition || '',
      lines: Array.isArray(r.lines) ? r.lines : [],
      sort: Number(r.sort) || 0,
      isActive: r.isActive !== false,
    }));
  }
}
