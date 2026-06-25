/**
 * EEStrategy — EE 品类排产策略
 *
 * EE 特点：
 *   - 产线：3F3, 3F4, 3F5, 3F6
 *   - 订单池：SC_YBSC_F3, SC_YBSC_HT, SCD_HT_CC, SCD_HT_F3
 *   - 不需要按客户分组
 */

import type { SchedulingStrategy, SchedulingConfig } from './SchedulingStrategy';

const EE_CONFIG: SchedulingConfig = {
  category: 'EE',
  setupTimeHours: 1,
  jitBufferDays: 2,  // 目标在 dlvDate - 2 天完成
  preferEarlyFinish: false, // EE 订单相对独立，按成本最优选择方案
  fallbackLines: ['3F3', '3F4', '3F5', '3F6'],
  lineSelectWeights: {
    capacity:      0.25, // 原 0.30，降低 0.05 给衔接度
    setupAffinity: 0.50, // 不变：换型亲和最重要
    loadBalance:   0.10, // 原 0.20，降低 0.10 给衔接度
    continuity:    0.15, // 新增：产线衔接度（前单完成越近，优先级越高）
  },
  maxHeadcountFactor: 4,  // 最多尝试 4 倍基准人数（+1人/次递增）
  earlyStartMaxDays:  7,  // 最多提前 7 天开工（从 JIT 基准日向前）
};


export class EEStrategy implements SchedulingStrategy {
  readonly name = 'EE';

  getConfig(): SchedulingConfig {
    return { ...EE_CONFIG };
  }

  filterOrders(orders: any[], poolSet: Set<string>): any[] {
    return orders.filter(
      (o) => (!o.osmCategory || o.osmCategory === 'EE') && poolSet.has(o.prodPoolId),
    );
  }

  getFallbackLines(): string[] {
    return [...EE_CONFIG.fallbackLines];
  }

  getActiveStages(): string[] {
    return []; // empty = all stages
  }
}
