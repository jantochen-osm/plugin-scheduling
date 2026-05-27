/**
 * Sprint 1 — StageDependencyManager
 *
 * 职责：管理工段间的依赖关系，确保后续工段在前序工段完成后才能开始。
 *
 * 核心逻辑：
 *   - 每个订单有多个工段（从 production_stages 获取）
 *   - 工段按 stageSequence 排序
 *   - 记录每个订单×工段的完成日期
 *   - 下一工段的最早开始日 = 上一工段的完成日 + 1 天
 *
 * 使用方式：
 *   const sdm = new StageDependencyManager();
 *   sdm.recordStageCompletion('ZMO001', 'Assembly', '2026-06-05');
 *   const earliest = sdm.getEarliestStartForNextStage('ZMO001'); // '2026-06-06'
 */

export interface StageCompletion {
  orderId: string;
  stageName: string;
  stageSequence: number;
  completionDate: string; // 'YYYY-MM-DD'
}

export class StageDependencyManager {
  /** orderId → stageName → completionDate */
  private completions: Map<string, Map<string, string>> = new Map();

  /** 工段序列定义 (stageName → stageSequence) */
  private stageSequenceMap: Map<string, number> = new Map();

  // ─── 工段定义 ───

  /** 注册工段序列（应从 production_stages 加载） */
  registerStages(stages: { stageName: string; stageSequence: number }[]): void {
    for (const s of stages) {
      this.stageSequenceMap.set(s.stageName, s.stageSequence);
    }
  }

  /** 获取所有已注册工段（按 sequence 排序） */
  getStagesInOrder(): string[] {
    return [...this.stageSequenceMap.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([name]) => name);
  }

  // ─── 工段完成记录 ───

  /** 记录某订单某工段的完成日期 */
  recordStageCompletion(orderId: string, stageName: string, completionDate: string): void {
    if (!this.completions.has(orderId)) {
      this.completions.set(orderId, new Map());
    }
    this.completions.get(orderId)!.set(stageName, completionDate);
  }

  /** 获取某订单下一工段的最早开始日 */
  getEarliestStartForNextStage(orderId: string): string | null {
    const orderCompletions = this.completions.get(orderId);
    if (!orderCompletions || orderCompletions.size === 0) return null;

    // 找已完成工段中 sequence 最大的
    let maxSeq = -1;
    let latestDate = '';
    for (const [stageName, date] of orderCompletions) {
      const seq = this.stageSequenceMap.get(stageName) ?? 0;
      if (seq > maxSeq || (seq === maxSeq && date > latestDate)) {
        maxSeq = seq;
        latestDate = date;
      }
    }

    if (!latestDate) return null;

    // 最早开始日 = 最晚完成日 + 1 天
    const d = new Date(latestDate);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }

  /** 获取某订单某工段的前序工段完成日期 */
  getPreviousStageCompletion(orderId: string, stageName: string): string | null {
    const orderCompletions = this.completions.get(orderId);
    if (!orderCompletions) return null;

    const currentSeq = this.stageSequenceMap.get(stageName) ?? 0;
    if (currentSeq <= 1) return null; // 第一工段无前序

    // 找 sequence = currentSeq - 1 的完成日期
    for (const [name, date] of orderCompletions) {
      const seq = this.stageSequenceMap.get(name) ?? 0;
      if (seq === currentSeq - 1) return date;
    }
    return null;
  }

  /** 判断某订单是否所有工段已完成 */
  isOrderComplete(orderId: string): boolean {
    const orderCompletions = this.completions.get(orderId);
    if (!orderCompletions) return false;
    return orderCompletions.size >= this.stageSequenceMap.size;
  }

  /** 获取某订单的最终完成日期 */
  getOrderCompletionDate(orderId: string): string | null {
    const orderCompletions = this.completions.get(orderId);
    if (!orderCompletions || orderCompletions.size === 0) return null;

    let latestDate = '';
    for (const date of orderCompletions.values()) {
      if (date > latestDate) latestDate = date;
    }
    return latestDate || null;
  }

  /** 获取某订单的依赖链（从第一工段到最后已完成工段） */
  getDependencyChain(orderId: string): StageCompletion[] {
    const orderCompletions = this.completions.get(orderId);
    if (!orderCompletions) return [];

    const stages = this.getStagesInOrder();
    const chain: StageCompletion[] = [];

    for (const stageName of stages) {
      const date = orderCompletions.get(stageName);
      if (date) {
        chain.push({
          orderId,
          stageName,
          stageSequence: this.stageSequenceMap.get(stageName) ?? 0,
          completionDate: date,
        });
      }
    }
    return chain;
  }

  /** 清空所有完成记录 */
  reset(): void {
    this.completions.clear();
  }

  /** 清空指定订单的记录 */
  resetOrder(orderId: string): void {
    this.completions.delete(orderId);
  }
}
