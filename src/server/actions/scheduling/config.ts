/**
 * scheduling/config.ts
 *
 * 排产引擎全局配置与日期工具函数。
 * 本文件是整个排产模块的唯一"魔法常量"来源。
 *
 * 注意：setupTimeHours / jitBufferDays 属于策略级配置，
 *       由 SchedulingStrategy.getConfig() 提供，不在此定义。
 */

/**
 * 排产历史起点日期。
 *
 * 这不是"测试 Mock 日期"，而是产能池和排产计算的最早起点。
 *
 * 必须早于所有已开工订单的实际开始日期。
 * 例：工厂订单最早从 2026-05-22 开工，此值必须 ≤ 2026-05-22。
 *
 * 若设为空，则使用系统当天日期 —— 这会导致历史订单失去产能上下文，
 * 所有订单被强制从当天重排，产生大量逾期和不合理增人。
 */
export const MOCK_TODAY = '2026-01-01';

// ── 日期工具函数 ────────────────────────────────────────────────────
export function formatDate(d: Date): string {
  // 使用本地时区日期（避免 UTC+8 环境下 toISOString 导致日期偏移 -1 天）
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return formatDate(d);
}

export function getToday(): Date {
  return MOCK_TODAY ? new Date(MOCK_TODAY + 'T00:00:00') : new Date();
}

export function getTodayStr(): string {
  return MOCK_TODAY || formatDate(new Date());
}

// ── 全局配置（策略无关的共享参数）─────────────────────────────────
export const SCHEDULING_CONFIG = {
  /** CapacityPool 初始化时的兜底每日工时（来源：md_work_calendars） */
  defaultWorkHours: 10,
  /** 排产窗口上限（天），防止无限循环 */
  maxDays: 365,
  /** 尾单合并最小阈值（件）：末日产量低于此值时并入前一天 */
  minTailQty: 10,
  /** 交期聚类窗口（天），用于 step3_sort 的 windowIdx 计算 */
  clusterWindowDays: 3,
  /** 成本模型，用于 tryScheduleStage 的方案优选 */
  costModel: {
    standardHourRate: 1.0,
    overtimeMultiplier: 2.5,
    additionalLineMultiplier: 1.2,
  },
} as const;
