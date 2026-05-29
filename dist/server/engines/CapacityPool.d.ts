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
import { RuleEngine } from './RuleEngine';
export type DayType = 'WORKDAY' | 'WEEKEND' | 'HOLIDAY' | 'MAINTENANCE' | 'CHANGEOVER' | 'IDLE';
export interface DayInfo {
    date: string;
    dayOfWeek: number;
    isWorkday: boolean;
    isSchedulable: boolean;
    baseWorkHours: number;
    availableHours: number;
    exceptionType: DayType | null;
    exceptionRemarks: string | null;
    dayType: DayType;
    dayLabel: string;
}
export interface CapacitySnapshot {
    line: string;
    date: string;
    baseHours: number;
    exceptionType: string | null;
    availableHours: number;
    usedHours: number;
}
export declare class CapacityPool {
    private ruleEngine;
    private baseHoursPerDay;
    /** line_date → { available, used } */
    private pool;
    /** date → base work hours (from md_work_calendars, before exceptions) */
    private workHoursByDate;
    /** date → exception info（补零日查询用） */
    private exceptionByDate;
    /** date → work calendar day info（补零日查询用） */
    private calDayByDate;
    /** 已加载的日期范围 */
    private dateRange;
    private lineCodes;
    constructor(ruleEngine: RuleEngine, baseHoursPerDay?: number);
    /**
     * 初始化产能池：为每条线、每个日期计算可用工时。
     * 基础工时来自 md_work_calendars，异常（HOLIDAY/MAINTENANCE）覆盖。
     */
    init(lineCodes: string[], startDate: string, endDate: string): Promise<void>;
    /** 获取某线某日剩余可用工时 */
    getAvailableHours(line: string, date: string): number;
    /** 分配产能（扣减工时），返回实际分配量 */
    allocate(line: string, date: string, hours: number): number;
    /**
     * 退还产能（rollback 专用），保证 used 不低于 0。
     * 不要用 allocate(-hours) 退还，那样会导致 used 变负、产能虚增。
     */
    release(line: string, date: string, hours: number): void;
    /** 获取某线的总已用工时 */
    getTotalLoad(line: string): number;
    /** 获取某线的总最大可用工时（未扣减前） */
    getMaxLoad(line: string): number;
    /** 获取某线的负载率 (0~1) */
    getLoadRate(line: string): number;
    /** 重置所有已用量（保留可用量） */
    reset(): void;
    /** 获取某日的基础工时（来自 md_work_calendars） */
    getWorkHoursForDate(date: string): number;
    /**
     * 获取某日期的完整信息（用于 dailyPlanDetail 构建）。
     * 产线无关，返回日历级信息；CHANGEOVER 场景由调用方额外标注。
     */
    getDayInfo(date: string): DayInfo;
    /** 异常类型中文标签 */
    private getExceptionLabel;
    /** 获取某线全部日期的快照 */
    getLineSnapshot(line: string): CapacitySnapshot[];
    /**
     * 根据异常类型调整可用工时。
     * baseHours 来自 md_work_calendars，异常在此基础上覆盖。
     * 异常优先级：HOLIDAY > MAINTENANCE > CHANGEOVER
     */
    private applyException;
    /** 生成日期范围（含起止） */
    private generateDateRange;
}
