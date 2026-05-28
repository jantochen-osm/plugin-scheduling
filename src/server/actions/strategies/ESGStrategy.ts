/**
 * ESGStrategy — ESG 品类排产策略
 *
 * ESG 产线分配规则：
 *   4F1 → Amazon（常规物料，customer_line_mapping）
 *   4F2 → Amazon 订单中 itemId 以 AMZ-55- 或 55- 开头的物料
 *            （工厂内称为 Chicha 线；customer_line_mapping 映射键为 "Chicha"）
 *            物料前缀路由在 scheduleAll 中硬判断，优先级高于客户映射
 *   4F4 → Shure（customer_line_mapping）
 *   4F6 → Jano Life（customer_line_mapping）
 *   4F3, 4F5 → 试产线，不参与排产
 *
 * 客户说明：
 *   - Chicha 是工厂内部叫法，系统订单里不体现该客户名称
 *   - SharkNinja 目前无产线映射，唯一订单已过期，暂不处理
 *
 * 客户→产线映射通过 customer_line_mapping 表维护，
 * 物料前缀路由在 scheduleAll 的产线获取阶段优先覆盖。
 */

import type { SchedulingStrategy, SchedulingConfig } from './SchedulingStrategy';
import { SCHEDULABLE_POOLS } from '../scheduling/config';


const ESG_CONFIG: SchedulingConfig = {
  category: 'ESG',
  setupTimeHours: 0, // 暂时禁用换型时间损耗（待业务确认后恢复）
  jitBufferDays: 2,  // 目标在 dlvDate - 2 天完成，给交期留出缓冲
  preferEarlyFinish: true, // 顺序排队：当前单尽快完成 = 产线尽早释放 = 后续单越容易准时
  fallbackLines: ['4F1', '4F2', '4F4', '4F6'], // 不含 4F3/4F5 试产线
  lineSelectWeights: {
    capacity: 0.3,
    setupAffinity: 0.5,
    loadBalance: 0.2,
  },
  maxHeadcountFactor: 4, // 最多尝试 4 倍基准人数（+1人/次递增）
};

export class ESGStrategy implements SchedulingStrategy {
  readonly name = 'ESG';

  getConfig(): SchedulingConfig {
    return { ...ESG_CONFIG };
  }

  filterOrders(orders: any[]): any[] {
    // 双重过滤：品类 + 订单池（池子定义见 scheduling/config.ts SCHEDULABLE_POOLS）
    return orders.filter(
      (o) => o.osmCategory === 'ESG' && (SCHEDULABLE_POOLS as readonly string[]).includes(o.prodPoolId),
    );
  }

  getFallbackLines(): string[] {
    return [...ESG_CONFIG.fallbackLines];
  }

  /** ESG 仅排 Assembly 工段 */
  getActiveStages(): string[] {
    return ['Assembly'];
  }

  /**
   * ESG 预处理：按 keyAccount 聚类，同一客户订单连排（减少换型）。
   *
   * 修复说明（2026-05-27）：
   *   step3_sort 的第 3 排序键是 itemId 字母升序，这会导致组内
   *   itemId 字母靠前的订单比交期更早的订单先排（如 AMZ-... 排在
   *   HQ2... 之前，即使 HQ2... 的 dlvDate 更早）。
   *   因此组内必须按 dlvDate 重新排序，确保同客户内交期最早的订单
   *   最先调度，不受 itemId 字母顺序影响。
   *
   * 排序规则：
   *   组间：按各组最早 dlvDate 升序（交期紧迫的客户优先）
   *   组内：先 overdueDays 降序，再 dlvDate 升序（交期越早越先排）
   */
  beforeSchedule(orders: any[]): any[] {
    const grouped = new Map<string, any[]>();
    for (const o of orders) {
      const key = o.keyAccount || '_unknown';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(o);
    }

    // 组内：按 overdueDays 降序 → dlvDate 升序（修正 step3_sort 中 itemId 优先于 dlvDate 的问题）
    for (const [, group] of grouped) {
      group.sort((a, b) => {
        if ((b.overdueDays ?? 0) !== (a.overdueDays ?? 0)) return (b.overdueDays ?? 0) - (a.overdueDays ?? 0);
        return new Date(a.dlvDate).getTime() - new Date(b.dlvDate).getTime();
      });
    }

    // 组间：按各组最早 dlvDate 升序排列客户组
    const sortedGroups = [...grouped.entries()].sort(([, ga], [, gb]) => {
      const aEarliest = ga.length > 0 ? new Date(ga[0].dlvDate).getTime() : Infinity;
      const bEarliest = gb.length > 0 ? new Date(gb[0].dlvDate).getTime() : Infinity;
      return aEarliest - bEarliest;
    });

    const result: any[] = [];
    for (const [, group] of sortedGroups) {
      result.push(...group);
    }
    return result;
  }
}
