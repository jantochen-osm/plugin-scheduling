/**
 * ESGStrategy -- ESG category scheduling strategy
 *
 * Line assignment:
 *   4F1 -> Amazon standard; 4F2 -> AMZ-55- / 55- prefix (Chicha line)
 *   4F4 -> Shure; 4F6 -> Jano Life
 *   4F3, 4F5 -> Trial lines, excluded
 */
import type { SchedulingStrategy, SchedulingConfig } from './SchedulingStrategy';

const ESG_CONFIG: SchedulingConfig = {
  category: 'ESG',
  setupTimeHours: 0,
  jitBufferDays: 0,          // sequential mode: no JIT
  preferEarlyFinish: false,  // sequential mode: unused
  fallbackLines: ['4F1', '4F2', '4F4', '4F6'], // 兜底产线（所有规则不命中时使用）
  lineSelectWeights: {
    capacity:      0.25,
    setupAffinity: 0.50,
    loadBalance:   0.10,
    continuity:    0.15,
  },
  maxHeadcountFactor: 4,
  // earlyStartMaxDays removed (sequential mode has no early-start concept)
};

export class ESGStrategy implements SchedulingStrategy {
  readonly name = 'ESG';

  getConfig(): SchedulingConfig { return { ...ESG_CONFIG }; }

  filterOrders(orders: any[], poolSet: Set<string>): any[] {
    return orders.filter(
      (o) => o.osmCategory === 'ESG' && poolSet.has(o.prodPoolId),
    );
  }

  getFallbackLines(): string[] { return [...ESG_CONFIG.fallbackLines]; }

  getActiveStages(): string[] { return ['Assembly']; }

  beforeSchedule(orders: any[]): any[] {
    const grouped = new Map<string, any[]>();
    for (const o of orders) {
      const key = o.keyAccount || '_unknown';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(o);
    }
    for (const [, group] of grouped) {
      group.sort((a, b) => {
        if ((b.overdueDays ?? 0) !== (a.overdueDays ?? 0)) return (b.overdueDays ?? 0) - (a.overdueDays ?? 0);
        return new Date(a.dlvDate).getTime() - new Date(b.dlvDate).getTime();
      });
    }
    const sortedGroups = [...grouped.entries()].sort(([, ga], [, gb]) => {
      const aE = ga.length > 0 ? new Date(ga[0].dlvDate).getTime() : Infinity;
      const bE = gb.length > 0 ? new Date(gb[0].dlvDate).getTime() : Infinity;
      return aE - bE;
    });
    const result: any[] = [];
    for (const [, g] of sortedGroups) result.push(...g);
    return result;
  }
}