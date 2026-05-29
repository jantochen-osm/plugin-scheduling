/**
 * scheduling/config.ts
 *
 * 排产引擎全局配置与日期工具函数。
 * 本文件是整个排产模块的唯一"魔法常量"来源。
 *
 * 注意：setupTimeHours / jitBufferDays 属于策略级配置，
 *       由 SchedulingStrategy.getConfig() 提供，不在此定义。
 */
/** 设为空字符串以使用系统真实日期 */
export declare const MOCK_TODAY = "2026-01-01";
export declare function formatDate(d: Date): string;
export declare function addDays(dateStr: string, n: number): string;
export declare function getToday(): Date;
export declare function getTodayStr(): string;
/**
 * 可参与排产的生产订单池白名单。
 *
 * 这些池子对应 3F / 4F 产线的装配工段，在 dn_operrouteline 中有完整的
 * UPH 路线数据。其他池子（SCD_Tooling_Non-Bond、V00896F_* 等）使用
 * Tooling / Bond Book 等不同工艺，无 UPH 数据，不应进入排产引擎。
 *
 * EE 和 ESG 共用同一份白名单。若某品类将来需要独立的池子配置，
 * 可在各自策略文件中覆盖，但默认来源始终是这里。
 */
export declare const SCHEDULABLE_POOLS: readonly ["SC_YBSC_F3", "SC_YBSC_HT", "SCD_HT_CC", "SCD_HT_F3"];
export declare const SCHEDULING_CONFIG: {
    /** CapacityPool 初始化时的兜底每日工时（来源：md_work_calendars） */
    readonly defaultWorkHours: 10;
    /** 排产窗口上限（天），防止无限循环 */
    readonly maxDays: 365;
    /** 尾单合并最小阈值（件）：末日产量低于此值时并入前一天 */
    readonly minTailQty: 10;
    /** 交期聚类窗口（天），用于 step3_sort 的 windowIdx 计算 */
    readonly clusterWindowDays: 3;
    /** 成本模型，用于 tryScheduleStage 的方案优选 */
    readonly costModel: {
        readonly standardHourRate: 1;
        readonly overtimeMultiplier: 2.5;
        readonly additionalLineMultiplier: 1.2;
    };
};
