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
export interface CustomerLineResult {
    keyAccount: string;
    osmCategory: string;
    assignedLines: string[];
}
export interface CalendarException {
    exceptionDate: string;
    exceptionType: 'HOLIDAY' | 'MAINTENANCE' | 'CHANGEOVER';
    affectedLines: string[] | null;
    workHours: number;
    setupTime: number;
    remarks?: string;
}
export interface WorkCalendarDay {
    calendarDate: string;
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
export declare class RuleEngine {
    private ctx;
    private customerLineCache;
    private calendarExceptionCache;
    private workCalendarCache;
    private weights;
    constructor(ctx: Context, weights?: Partial<LineSelectWeights>);
    /** 获取客户分配的产线 */
    getCustomerLines(keyAccount: string): Promise<CustomerLineResult | null>;
    /** 获取指定日期的日历异常（null = 无异常） */
    getCalendarException(date: string): Promise<CalendarException | null>;
    /** 获取指定日期的工作日历（产线无关的基础日历） */
    getWorkCalendarDay(date: string): Promise<WorkCalendarDay | null>;
    /** 获取选线权重 */
    getLineSelectWeights(): LineSelectWeights;
    /** 强制刷新所有缓存 */
    invalidateCache(): void;
    private ensureCustomerLineCache;
    private ensureCalendarExceptionCache;
    private ensureWorkCalendarCache;
}
