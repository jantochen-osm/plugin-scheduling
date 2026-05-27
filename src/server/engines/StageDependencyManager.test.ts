/**
 * StageDependencyManager 单元测试
 *
 * 测试范围：
 *   - registerStages / getStagesInOrder
 *   - recordStageCompletion / getEarliestStartForNextStage
 *   - getPreviousStageCompletion
 *   - isOrderComplete / getOrderCompletionDate
 *   - getDependencyChain
 *   - reset / resetOrder
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StageDependencyManager } from './StageDependencyManager';

describe('StageDependencyManager', () => {
  let sdm: StageDependencyManager;

  beforeEach(() => {
    sdm = new StageDependencyManager();
    sdm.registerStages([
      { stageName: 'Assembly', stageSequence: 1 },
      { stageName: 'Package', stageSequence: 2 },
      { stageName: 'Testing', stageSequence: 3 },
    ]);
  });

  describe('registerStages / getStagesInOrder', () => {
    it('按 sequence 排序返回工段', () => {
      const stages = sdm.getStagesInOrder();
      expect(stages).toEqual(['Assembly', 'Package', 'Testing']);
    });
  });

  describe('recordStageCompletion', () => {
    it('记录工段完成日期', () => {
      sdm.recordStageCompletion('ORD001', 'Assembly', '2026-06-01');
      const earliest = sdm.getEarliestStartForNextStage('ORD001');
      expect(earliest).toBe('2026-06-02');
    });

    it('多工段记录取最晚', () => {
      sdm.recordStageCompletion('ORD001', 'Assembly', '2026-06-01');
      sdm.recordStageCompletion('ORD001', 'Package', '2026-06-03');
      const earliest = sdm.getEarliestStartForNextStage('ORD001');
      expect(earliest).toBe('2026-06-04'); // Package(seq=2) + 1 day
    });
  });

  describe('getEarliestStartForNextStage', () => {
    it('无记录返回 null', () => {
      expect(sdm.getEarliestStartForNextStage('ORD_NEW')).toBeNull();
    });

    it('第一工段完成后返回次日', () => {
      sdm.recordStageCompletion('ORD001', 'Assembly', '2026-06-10');
      expect(sdm.getEarliestStartForNextStage('ORD001')).toBe('2026-06-11');
    });
  });

  describe('getPreviousStageCompletion', () => {
    it('第一工段无前序', () => {
      sdm.recordStageCompletion('ORD001', 'Assembly', '2026-06-01');
      expect(sdm.getPreviousStageCompletion('ORD001', 'Assembly')).toBeNull();
    });

    it('返回前序工段完成日', () => {
      sdm.recordStageCompletion('ORD001', 'Assembly', '2026-06-01');
      sdm.recordStageCompletion('ORD001', 'Package', '2026-06-03');
      expect(sdm.getPreviousStageCompletion('ORD001', 'Package')).toBe('2026-06-01');
    });

    it('前序未完成返回 null', () => {
      expect(sdm.getPreviousStageCompletion('ORD001', 'Package')).toBeNull();
    });
  });

  describe('isOrderComplete', () => {
    it('所有工段完成返回 true', () => {
      sdm.recordStageCompletion('ORD001', 'Assembly', '2026-06-01');
      sdm.recordStageCompletion('ORD001', 'Package', '2026-06-03');
      sdm.recordStageCompletion('ORD001', 'Testing', '2026-06-05');
      expect(sdm.isOrderComplete('ORD001')).toBe(true);
    });

    it('部分工段完成返回 false', () => {
      sdm.recordStageCompletion('ORD001', 'Assembly', '2026-06-01');
      expect(sdm.isOrderComplete('ORD001')).toBe(false);
    });

    it('无记录返回 false', () => {
      expect(sdm.isOrderComplete('ORD_NEW')).toBe(false);
    });
  });

  describe('getOrderCompletionDate', () => {
    it('返回最晚完成日', () => {
      sdm.recordStageCompletion('ORD001', 'Assembly', '2026-06-01');
      sdm.recordStageCompletion('ORD001', 'Package', '2026-06-05');
      expect(sdm.getOrderCompletionDate('ORD001')).toBe('2026-06-05');
    });

    it('无记录返回 null', () => {
      expect(sdm.getOrderCompletionDate('ORD_NEW')).toBeNull();
    });
  });

  describe('getDependencyChain', () => {
    it('按工段顺序返回完成链', () => {
      sdm.recordStageCompletion('ORD001', 'Package', '2026-06-03');
      sdm.recordStageCompletion('ORD001', 'Assembly', '2026-06-01');
      const chain = sdm.getDependencyChain('ORD001');
      expect(chain).toHaveLength(2);
      expect(chain[0].stageName).toBe('Assembly');
      expect(chain[1].stageName).toBe('Package');
    });

    it('无记录返回空数组', () => {
      expect(sdm.getDependencyChain('ORD_NEW')).toEqual([]);
    });
  });

  describe('reset / resetOrder', () => {
    it('reset 清除所有记录', () => {
      sdm.recordStageCompletion('ORD001', 'Assembly', '2026-06-01');
      sdm.recordStageCompletion('ORD002', 'Assembly', '2026-06-02');
      sdm.reset();
      expect(sdm.getEarliestStartForNextStage('ORD001')).toBeNull();
      expect(sdm.getEarliestStartForNextStage('ORD002')).toBeNull();
    });

    it('resetOrder 只清除指定订单', () => {
      sdm.recordStageCompletion('ORD001', 'Assembly', '2026-06-01');
      sdm.recordStageCompletion('ORD002', 'Assembly', '2026-06-02');
      sdm.resetOrder('ORD001');
      expect(sdm.getEarliestStartForNextStage('ORD001')).toBeNull();
      expect(sdm.getEarliestStartForNextStage('ORD002')).toBe('2026-06-03');
    });
  });
});
