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

// ─── 日期详情 ───

export type DayType = 'WORKDAY' | 'WEEKEND' | 'HOLIDAY' | 'MAINTENANCE' | 'CHANGEOVER' | 'IDLE';

export interface DayInfo {
  date: string;
  dayOfWeek: number;           // 0=Sun ... 6=Sat
  isWorkday: boolean;          // 来自 md_work_calendars
  isSchedulable: boolean;
  baseWorkHours: number;       // 日历基础工时（异常前）
  availableHours: number;      // 异常后可用工时（产线无关，取全线值）
  exceptionType: DayType | null;
  exceptionRemarks: string | null;
  dayType: DayType;
  dayLabel: string;
}

const DAY_LABELS: Record<string, string> = {
  '0': '周日', '1': '周一', '2': '周二', '3': '周三',
  '4': '周四', '5': '周五', '6': '周六',
};

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

  /** date → exception info（补零日查询用） */
  private exceptionByDate: Map<string, { type: string; remarks: string }> = new Map();

  /** date → work calendar day info（补零日查询用） */
  private calDayByDate: Map<string, { isWorkday: boolean; isSchedulable: boolean; dayOfWeek: number; workHours: number }> = new Map();

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
    this.exceptionByDate.clear();
    this.calDayByDate.clear();
    this.dateRange = this.generateDateRange(startDate, endDate);

    for (const date of this.dateRange) {
      // 1. 工作日历基础工时
      const calDay = await this.ruleEngine.getWorkCalendarDay(date);
      let baseHours = calDay?.workHours ?? this.baseHoursPerDay;
      if (calDay && !calDay.isSchedulable) {
        baseHours = 0;
      }
      this.workHoursByDate.set(date, baseHours);
      this.calDayByDate.set(date, {
        isWorkday: !!calDay?.isWorkday,
        isSchedulable: !!calDay?.isSchedulable,
        dayOfWeek: calDay?.dayOfWeek ?? 0,
        workHours: calDay?.workHours ?? this.baseHoursPerDay,
      });

      // 2. 检查 calendar_exceptions 覆盖
      const exception = await this.ruleEngine.getCalendarException(date);
      if (exception) {
        this.exceptionByDate.set(date, {
          type: exception.exceptionType,
          remarks: exception.remarks || '',
        });
      }

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

  /**
   * 获取某日期的完整信息（用于 dailyPlanDetail 构建）。
   * 产线无关，返回日历级信息；CHANGEOVER 场景由调用方额外标注。
   */
  getDayInfo(date: string): DayInfo {
    const cal = this.calDayByDate.get(date);
    const dayOfWeek = cal?.dayOfWeek ?? 0;
    const isWorkday = cal?.isWorkday ?? true;
    const isSchedulable = cal?.isSchedulable ?? true;
    const baseWorkHours = this.workHoursByDate.get(date) ?? this.baseHoursPerDay;
    const exc = this.exceptionByDate.get(date);

    const availableHours = isSchedulable ? baseWorkHours : 0;

    // 推断 dayType
    let dayType: DayType;
    let dayLabel: string;
    const dowLabel = DAY_LABELS[String(dayOfWeek)] || '';

    if (exc) {
      dayType = exc.type as DayType;
      dayLabel = exc.remarks
        ? `${this.getExceptionLabel(exc.type)}（${exc.remarks}）`
        : this.getExceptionLabel(exc.type);
    } else if (!isSchedulable && !isWorkday) {
      dayType = 'WEEKEND';
      dayLabel = dowLabel;
    } else if (!isSchedulable) {
      dayType = 'IDLE';
      dayLabel = dowLabel;
    } else {
      dayType = 'WORKDAY';
      dayLabel = dowLabel;
    }

    return {
      date,
      dayOfWeek,
      isWorkday,
      isSchedulable,
      baseWorkHours,
      availableHours,
      exceptionType: exc ? (exc.type as DayType) : null,
      exceptionRemarks: exc?.remarks || null,
      dayType,
      dayLabel,
    };
  }

  /** 异常类型中文标签 */
  private getExceptionLabel(type: string): string {
    switch (type) {
      case 'HOLIDAY': return '假期';
      case 'MAINTENANCE': return '设备保养';
      case 'CHANGEOVER': return '产品换线';
      default: return type;
    }
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
