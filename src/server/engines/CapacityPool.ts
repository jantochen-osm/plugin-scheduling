/**
 * Sprint 1 — CapacityPool
 *
 * 职责：管理产线产能池，处理日历异常对产能的影响。
 *
 * 异常优先级（高→低）：
 *   1. HOLIDAY      → workHours = 0（全线/部分线停工）
 *   2. MAINTENANCE  → workHours 降低（设备保养）
 *   3. CHANGEOVER   → 额外 setupTime 消耗
 *
 * 使用方式：
 *   const pool = new CapacityPool(ruleEngine, baseHoursPerDay);
 *   await pool.init(lineCodes, startDate, endDate);
 *   const avail = pool.getAvailableHours('3F3', '2026-06-01');
 *   pool.allocate('3F3', '2026-06-01', 5.5);
 */

import { RuleEngine, CalendarException } from './RuleEngine';

export interface CapacitySnapshot {
  line: string;
  date: string;
  baseHours: number;
  exceptionType: string | null;
  availableHours: number;
  usedHours: number;
}

export class CapacityPool {
  private ruleEngine: RuleEngine;
  private baseHoursPerDay: number;

  /** line_date → { available, used } */
  private pool: Map<string, { available: number; used: number }> = new Map();

  /** date → base work hours (from md_work_calendars, before exceptions) */
  private workHoursByDate: Map<string, number> = new Map();

  /** 已加载的日期范围 */
  private dateRange: string[] = [];
  private lineCodes: string[] = [];

  constructor(ruleEngine: RuleEngine, baseHoursPerDay = 10) {
    this.ruleEngine = ruleEngine;
    this.baseHoursPerDay = baseHoursPerDay;
  }

  // ─── 初始化 ───

  /**
   * 初始化产能池：为每条线、每个日期计算可用工时。
   * 基础工时来自 md_work_calendars，异常（HOLIDAY/MAINTENANCE）覆盖。
   */
  async init(lineCodes: string[], startDate: string, endDate: string): Promise<void> {
    this.lineCodes = [...lineCodes];
    this.pool.clear();
    this.dateRange = this.generateDateRange(startDate, endDate);

    for (const date of this.dateRange) {
      // 1. 工作日历基础工时
      const calDay = await this.ruleEngine.getWorkCalendarDay(date);
      let baseHours = calDay?.workHours ?? this.baseHoursPerDay;
      if (calDay && !calDay.isSchedulable) {
        baseHours = 0;
      }
      this.workHoursByDate.set(date, baseHours);

      // 2. 检查 calendar_exceptions 覆盖
      const exception = await this.ruleEngine.getCalendarException(date);

      for (const line of lineCodes) {
        const key = `${line}_${date}`;
        const { availableHours } = this.applyException(line, date, exception, baseHours);
        this.pool.set(key, { available: availableHours, used: 0 });
      }
    }
  }

  // ─── 公开方法 ───

  /** 获取某线某日剩余可用工时 */
  getAvailableHours(line: string, date: string): number {
    const key = `${line}_${date}`;
    const entry = this.pool.get(key);
    if (!entry) return 0;
    return Math.max(0, entry.available - entry.used);
  }

  /** 分配产能（扣减工时），返回实际分配量 */
  allocate(line: string, date: string, hours: number): number {
    const key = `${line}_${date}`;
    const entry = this.pool.get(key);
    if (!entry) return 0;

    const available = Math.max(0, entry.available - entry.used);
    const allocated = Math.min(hours, available);
    entry.used += allocated;
    return allocated;
  }

  /**
   * 退还产能（rollback 专用），保证 used 不低于 0。
   * 不要用 allocate(-hours) 退还，那样会导致 used 变负、产能虚增。
   */
  release(line: string, date: string, hours: number): void {
    const key = `${line}_${date}`;
    const entry = this.pool.get(key);
    if (!entry) return;
    entry.used = Math.max(0, entry.used - hours);
  }

  /** 获取某线的总已用工时 */
  getTotalLoad(line: string): number {
    let total = 0;
    for (const [key, entry] of this.pool) {
      if (key.startsWith(`${line}_`)) {
        total += entry.used;
      }
    }
    return total;
  }

  /** 获取某线的总最大可用工时（未扣减前） */
  getMaxLoad(line: string): number {
    let total = 0;
    for (const [key, entry] of this.pool) {
      if (key.startsWith(`${line}_`)) {
        total += entry.available;
      }
    }
    return total;
  }

  /** 获取某线的负载率 (0~1) */
  getLoadRate(line: string): number {
    const max = this.getMaxLoad(line);
    if (max === 0) return 0;
    return this.getTotalLoad(line) / max;
  }

  /** 重置所有已用量（保留可用量） */
  reset(): void {
    for (const entry of this.pool.values()) {
      entry.used = 0;
    }
  }

  /** 获取某日的基础工时（来自 md_work_calendars） */
  getWorkHoursForDate(date: string): number {
    return this.workHoursByDate.get(date) ?? this.baseHoursPerDay;
  }

  /** 获取某线全部日期的快照 */
  getLineSnapshot(line: string): CapacitySnapshot[] {
    const snapshots: CapacitySnapshot[] = [];
    for (const date of this.dateRange) {
      const key = `${line}_${date}`;
      const entry = this.pool.get(key);
      if (entry) {
        snapshots.push({
          line,
          date,
          baseHours: this.workHoursByDate.get(date) ?? this.baseHoursPerDay,
          exceptionType: null,
          availableHours: entry.available,
          usedHours: entry.used,
        });
      }
    }
    return snapshots;
  }

  // ─── 内部方法 ───

  /**
   * 根据异常类型调整可用工时。
   * baseHours 来自 md_work_calendars，异常在此基础上覆盖。
   * 异常优先级：HOLIDAY > MAINTENANCE > CHANGEOVER
   */
  private applyException(
    line: string,
    date: string,
    exception: CalendarException | null,
    baseHours: number,
  ): { availableHours: number; exceptionType: string | null } {
    if (!exception) {
      return { availableHours: baseHours, exceptionType: null };
    }

    const affectsLine =
      exception.affectedLines === null || exception.affectedLines.includes(line);

    if (!affectsLine) {
      return { availableHours: baseHours, exceptionType: null };
    }

    switch (exception.exceptionType) {
      case 'HOLIDAY':
        return { availableHours: exception.workHours, exceptionType: 'HOLIDAY' };

      case 'MAINTENANCE':
        return {
          availableHours: Math.min(exception.workHours, baseHours),
          exceptionType: 'MAINTENANCE',
        };

      case 'CHANGEOVER':
        return { availableHours: baseHours, exceptionType: 'CHANGEOVER' };

      default:
        return { availableHours: baseHours, exceptionType: null };
    }
  }

  /** 生成日期范围（含起止） */
  private generateDateRange(start: string, end: string): string[] {
    const dates: string[] = [];
    const cur = new Date(start);
    const endDate = new Date(end);
    while (cur <= endDate) {
      dates.push(cur.toISOString().split('T')[0]);
      cur.setDate(cur.getDate() + 1);
    }
    return dates;
  }
}
