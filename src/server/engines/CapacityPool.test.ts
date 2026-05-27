/**
 * CapacityPool 单元测试
 *
 * 测试范围：
 *   - 初始化产能池
 *   - 异常类型对产能的影响（HOLIDAY / MAINTENANCE / CHANGEOVER）
 *   - allocate / getAvailableHours
 *   - getTotalLoad / getMaxLoad / getLoadRate
 *   - reset
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CapacityPool } from './CapacityPool';
import { RuleEngine } from './RuleEngine';

// ─── Helper: 创建一个预加载了异常的 RuleEngine ───

function createRuleEngineWithExceptions(exceptions: Map<string, any>) {
  return {
    getCalendarException: vi.fn(async (date: string) => exceptions.get(date) ?? null),
    getWorkCalendarDay: vi.fn(async (_date: string) => null),
    getLineSelectWeights: vi.fn(() => ({ capacity: 0.3, setupAffinity: 0.5, loadBalance: 0.2 })),
    invalidateCache: vi.fn(),
    getCustomerLines: vi.fn(),
  } as unknown as RuleEngine;
}

// ─── Tests ───

describe('CapacityPool', () => {
  let pool: CapacityPool;

  describe('无异常场景', () => {
    beforeEach(async () => {
      const engine = createRuleEngineWithExceptions(new Map());
      pool = new CapacityPool(engine, 10);
      await pool.init(['3F3', '3F4'], '2026-06-01', '2026-06-03');
    });

    it('初始可用工时 = baseHoursPerDay', () => {
      expect(pool.getAvailableHours('3F3', '2026-06-01')).toBe(10);
      expect(pool.getAvailableHours('3F4', '2026-06-02')).toBe(10);
    });

    it('allocate 扣减工时', () => {
      const allocated = pool.allocate('3F3', '2026-06-01', 5);
      expect(allocated).toBe(5);
      expect(pool.getAvailableHours('3F3', '2026-06-01')).toBe(5);
    });

    it('allocate 不超过可用量', () => {
      const allocated = pool.allocate('3F3', '2026-06-01', 15);
      expect(allocated).toBe(10); // capped at available
      expect(pool.getAvailableHours('3F3', '2026-06-01')).toBe(0);
    });

    it('不存在的线/日期返回 0', () => {
      expect(pool.getAvailableHours('UNKNOWN', '2026-06-01')).toBe(0);
      expect(pool.getAvailableHours('3F3', '2099-01-01')).toBe(0);
    });

    it('getTotalLoad 统计已用工时', () => {
      pool.allocate('3F3', '2026-06-01', 3);
      pool.allocate('3F3', '2026-06-02', 4);
      pool.allocate('3F4', '2026-06-01', 2);
      expect(pool.getTotalLoad('3F3')).toBe(7);
      expect(pool.getTotalLoad('3F4')).toBe(2);
    });

    it('getMaxLoad 返回总可用工时', () => {
      // 3F3: 3 days × 10 hours = 30
      expect(pool.getMaxLoad('3F3')).toBe(30);
    });

    it('getLoadRate 计算负载率', () => {
      pool.allocate('3F3', '2026-06-01', 6);
      expect(pool.getLoadRate('3F3')).toBeCloseTo(6 / 30);
    });

    it('reset 清除已用量', () => {
      pool.allocate('3F3', '2026-06-01', 5);
      pool.reset();
      expect(pool.getTotalLoad('3F3')).toBe(0);
      expect(pool.getAvailableHours('3F3', '2026-06-01')).toBe(10);
    });
  });

  describe('异常场景', () => {
    it('HOLIDAY 全线停工', async () => {
      const exceptions = new Map([
        ['2026-06-01', { exceptionDate: '2026-06-01', exceptionType: 'HOLIDAY', affectedLines: null, workHours: 0, setupTime: 0 }],
      ]);
      const engine = createRuleEngineWithExceptions(exceptions);
      pool = new CapacityPool(engine, 10);
      await pool.init(['3F3', '3F4'], '2026-06-01', '2026-06-02');

      expect(pool.getAvailableHours('3F3', '2026-06-01')).toBe(0);
      expect(pool.getAvailableHours('3F4', '2026-06-01')).toBe(0);
      expect(pool.getAvailableHours('3F3', '2026-06-02')).toBe(10); // 正常日
    });

    it('MAINTENANCE 单线减时', async () => {
      const exceptions = new Map([
        ['2026-06-01', { exceptionDate: '2026-06-01', exceptionType: 'MAINTENANCE', affectedLines: ['3F3'], workHours: 4, setupTime: 0 }],
      ]);
      const engine = createRuleEngineWithExceptions(exceptions);
      pool = new CapacityPool(engine, 10);
      await pool.init(['3F3', '3F4'], '2026-06-01', '2026-06-01');

      expect(pool.getAvailableHours('3F3', '2026-06-01')).toBe(4);
      expect(pool.getAvailableHours('3F4', '2026-06-01')).toBe(10); // 不受影响
    });

    it('CHANGEOVER 不影响工时（保留原始工时）', async () => {
      const exceptions = new Map([
        ['2026-06-01', { exceptionDate: '2026-06-01', exceptionType: 'CHANGEOVER', affectedLines: ['1F1'], workHours: 10, setupTime: 120 }],
      ]);
      const engine = createRuleEngineWithExceptions(exceptions);
      pool = new CapacityPool(engine, 10);
      await pool.init(['1F1'], '2026-06-01', '2026-06-01');

      // CHANGEOVER keeps base hours; setupTime is handled by scheduling logic
      expect(pool.getAvailableHours('1F1', '2026-06-01')).toBe(10);
    });
  });

  describe('getLineSnapshot', () => {
    it('返回线的每日快照', async () => {
      const engine = createRuleEngineWithExceptions(new Map());
      pool = new CapacityPool(engine, 10);
      await pool.init(['3F3'], '2026-06-01', '2026-06-02');

      pool.allocate('3F3', '2026-06-01', 3);
      const snap = pool.getLineSnapshot('3F3');
      expect(snap).toHaveLength(2);
      expect(snap[0].availableHours).toBe(10);
      expect(snap[0].usedHours).toBe(3);
    });
  });
});
