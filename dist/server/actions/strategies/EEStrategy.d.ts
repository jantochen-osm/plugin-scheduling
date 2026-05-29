/**
 * EEStrategy — EE 品类排产策略
 *
 * EE 特点：
 *   - 产线：3F3, 3F4, 3F5, 3F6
 *   - 订单池：SC_YBSC_F3, SC_YBSC_HT, SCD_HT_CC, SCD_HT_F3
 *   - 不需要按客户分组
 */
import type { SchedulingStrategy, SchedulingConfig } from './SchedulingStrategy';
export declare class EEStrategy implements SchedulingStrategy {
    readonly name = "EE";
    getConfig(): SchedulingConfig;
    filterOrders(orders: any[]): any[];
    getFallbackLines(): string[];
    getActiveStages(): string[];
}
