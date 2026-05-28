/**
 * EEStrategy — EE 品类排产策略
 *
 * EE 特点：
 *   - 产线：3F3, 3F4, 3F5, 3F6
 *   - 订单池：SC_YBSC_F3, SC_YBSC_HT, SCD_HT_CC, SCD_HT_F3
 *   - 不需要按客户分组
 */

import type { SchedulingStrategy, SchedulingConfig } from './SchedulingStrategy';
import { SCHEDULABLE_POOLS } from '../scheduling/config';

const EE_CONFIG: SchedulingConfig = {
  category: 'EE',
  setupTimeHours: 1,
  jitBufferDays: 2,  // 目标在 dlvDate - 2 天完成
  preferEarlyFinish: false, // EE 订单相对独立，按成本最优选择方案
  fallbackLines: ['3F3', '3F4', '3F5', '3F6'],
  lineSelectWeights: {
    capacity: 0.3,
    setupAffinity: 0.5,
    loadBalance: 0.2,
  },
  maxHeadcountFactor: 4, // 最多尝试 4 倍基准人数（+1人/次递增）
};


export class EEStrategy implements SchedulingStrategy {
  readonly name = 'EE';

  getConfig(): SchedulingConfig {
    return { ...EE_CONFIG };
  }

  filterOrders(orders: any[]): any[] {
    // 双重过滤：品类 + 订单池（池子定义见 scheduling/config.ts SCHEDULABLE_POOLS）
    return orders.filter(
      (o) => o.osmCategory === 'EE' && (SCHEDULABLE_POOLS as readonly string[]).includes(o.prodPoolId),
    );
  }

  getFallbackLines(): string[] {
    return [...EE_CONFIG.fallbackLines];
  }

  getActiveStages(): string[] {
    return []; // empty = all stages
  }
}
