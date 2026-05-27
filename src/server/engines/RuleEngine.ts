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

import type { Context } from '@nocobase/server';

// ─── 类型定义 ───

export interface CustomerLineResult {
  keyAccount: string;
  osmCategory: string;
  assignedLines: string[];
}

export interface CalendarException {
  exceptionDate: string; // 'YYYY-MM-DD'
  exceptionType: 'HOLIDAY' | 'MAINTENANCE' | 'CHANGEOVER';
  affectedLines: string[] | null; // null = 全线
  workHours: number; // 0 = 全线停工
  setupTime: number; // 换线耗时（分钟）
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

// ─── Engine 类 ───

export class RuleEngine {
  private ctx: Context;

  // 缓存
  private customerLineCache: Map<string, CustomerLineResult> | null = null;
  private calendarExceptionCache: Map<string, CalendarException> | null = null;
  private workCalendarCache: Map<string, WorkCalendarDay> | null = null;
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

  /** 强制刷新所有缓存 */
  invalidateCache(): void {
    this.customerLineCache = null;
    this.calendarExceptionCache = null;
    this.workCalendarCache = null;
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
          ? r.exceptionDate.toISOString().split('T')[0]
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
          ? r.calendarDate.toISOString().split('T')[0]
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
}
