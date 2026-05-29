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
    completionDate: string;
}
export declare class StageDependencyManager {
    /** orderId → stageName → completionDate */
    private completions;
    /** 工段序列定义 (stageName → stageSequence) */
    private stageSequenceMap;
    /** 注册工段序列（应从 production_stages 加载） */
    registerStages(stages: {
        stageName: string;
        stageSequence: number;
    }[]): void;
    /** 获取所有已注册工段（按 sequence 排序） */
    getStagesInOrder(): string[];
    /** 记录某订单某工段的完成日期 */
    recordStageCompletion(orderId: string, stageName: string, completionDate: string): void;
    /** 获取某订单下一工段的最早开始日 */
    getEarliestStartForNextStage(orderId: string): string | null;
    /** 获取某订单某工段的前序工段完成日期 */
    getPreviousStageCompletion(orderId: string, stageName: string): string | null;
    /** 判断某订单是否所有工段已完成 */
    isOrderComplete(orderId: string): boolean;
    /** 获取某订单的最终完成日期 */
    getOrderCompletionDate(orderId: string): string | null;
    /** 获取某订单的依赖链（从第一工段到最后已完成工段） */
    getDependencyChain(orderId: string): StageCompletion[];
    /** 清空所有完成记录 */
    reset(): void;
    /** 清空指定订单的记录 */
    resetOrder(orderId: string): void;
}
