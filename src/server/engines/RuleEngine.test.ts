/**
 * RuleEngine 单元测试
 *
 * 测试范围：
 *   - 缓存加载与失效
 *   - getCustomerLines
 *   - getCalendarException
 *   - getWorkCalendarDay
 *   - getLineSelectWeights
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RuleEngine } from './RuleEngine';

// ─── Mock Context ───

function createMockCtx(repoData: Record<string, any[]>) {
  const getRepository = vi.fn((name: string) => ({
    find: vi.fn(async () => repoData[name] ?? []),
  }));

  return {
    db: { getRepository },
  } as any;
}

// ─── Test Data ───

const mockCustomerLineRows = [
  { keyAccount: 'CUST_A', osmCategory: 'ESG', assignedLines: ['ESG_LINE_1'] },
  { keyAccount: 'CUST_B', osmCategory: 'ESG', assignedLines: ['ESG_LINE_1', 'ESG_LINE_2'] },
];

const mockCalendarRows = [
  { exceptionDate: new Date('2026-06-01'), exceptionType: 'HOLIDAY', affectedLines: null, workHours: 0, setupTime: 0, remarks: 'Holiday' },
  { exceptionDate: new Date('2026-06-05'), exceptionType: 'MAINTENANCE', affectedLines: ['3F3'], workHours: 8, setupTime: 0, remarks: 'Maintenance' },
];

const mockWorkCalendarRows = [
  { calendarDate: new Date('2026-06-01'), isWorkday: true, isSchedulable: true, workHours: 10, dayOfWeek: 1 },
  { calendarDate: new Date('2026-06-06'), isWorkday: true, isSchedulable: true, workHours: 8, dayOfWeek: 6 },
  { calendarDate: new Date('2026-06-07'), isWorkday: false, isSchedulable: false, workHours: 0, dayOfWeek: 0 },
];

// ─── Tests ───

describe('RuleEngine', () => {
  let engine: RuleEngine;

  beforeEach(() => {
    const ctx = createMockCtx({
      customer_line_mapping: mockCustomerLineRows,
      calendar_exceptions: mockCalendarRows,
      md_work_calendars: mockWorkCalendarRows,
    });
    engine = new RuleEngine(ctx);
  });

  describe('getCustomerLines', () => {
    it('返回客户分配的产线', async () => {
      const result = await engine.getCustomerLines('CUST_A');
      expect(result).not.toBeNull();
      expect(result!.assignedLines).toEqual(['ESG_LINE_1']);
    });

    it('未知客户返回 null', async () => {
      const result = await engine.getCustomerLines('UNKNOWN');
      expect(result).toBeNull();
    });
  });

  describe('getCalendarException', () => {
    it('返回指定日期的异常', async () => {
      const ex = await engine.getCalendarException('2026-06-01');
      expect(ex).not.toBeNull();
      expect(ex!.exceptionType).toBe('HOLIDAY');
      expect(ex!.workHours).toBe(0);
    });

    it('无异常日期返回 null', async () => {
      const ex = await engine.getCalendarException('2026-06-02');
      expect(ex).toBeNull();
    });

    it('部分产线受影响的异常', async () => {
      const ex = await engine.getCalendarException('2026-06-05');
      expect(ex).not.toBeNull();
      expect(ex!.exceptionType).toBe('MAINTENANCE');
      expect(ex!.affectedLines).toEqual(['3F3']);
    });
  });

  describe('getWorkCalendarDay', () => {
    it('返回工作日的工作日历', async () => {
      const day = await engine.getWorkCalendarDay('2026-06-01');
      expect(day).not.toBeNull();
      expect(day!.isWorkday).toBe(true);
      expect(day!.isSchedulable).toBe(true);
      expect(day!.workHours).toBe(10);
    });

    it('周六 8 小时', async () => {
      const day = await engine.getWorkCalendarDay('2026-06-06');
      expect(day).not.toBeNull();
      expect(day!.workHours).toBe(8);
      expect(day!.dayOfWeek).toBe(6);
    });

    it('周日不可排产', async () => {
      const day = await engine.getWorkCalendarDay('2026-06-07');
      expect(day).not.toBeNull();
      expect(day!.isWorkday).toBe(false);
      expect(day!.isSchedulable).toBe(false);
      expect(day!.workHours).toBe(0);
    });

    it('未定义的日期返回 null', async () => {
      const day = await engine.getWorkCalendarDay('2099-01-01');
      expect(day).toBeNull();
    });
  });

  describe('getLineSelectWeights', () => {
    it('返回默认权重', () => {
      const w = engine.getLineSelectWeights();
      expect(w.capacity).toBe(0.3);
      expect(w.setupAffinity).toBe(0.5);
      expect(w.loadBalance).toBe(0.2);
    });

    it('支持自定义权重', () => {
      const e2 = new RuleEngine({} as any, { capacity: 0.5, setupAffinity: 0.3, loadBalance: 0.2 });
      const w = e2.getLineSelectWeights();
      expect(w.capacity).toBe(0.5);
    });
  });

  describe('invalidateCache', () => {
    it('清除后重新加载', async () => {
      await engine.getCustomerLines('CUST_A');
      engine.invalidateCache();
      const result = await engine.getCustomerLines('CUST_A');
      expect(result).not.toBeNull();
    });
  });
});
