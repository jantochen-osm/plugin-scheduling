/**
 * llmDecision.ts
 *
 * LLM 排产决策层：调用 OpenAI Chat Completions API，
 * 读取 scheduling-skill.md 作为 system prompt，
 * 将订单摘要 + 产线映射作为 user message，
 * 解析并返回 SchedulingDecision[]。
 *
 * 任何异常（网络错误、解析失败、schema 不合法）均返回 null，
 * 调用方应 fallback 到原算法。
 */
export interface SchedulingDecision {
    prodId: string;
    /** 排产优先级，1 = 最高 */
    priority: number;
    /** 产线偏好顺序（代码会先尝试第一个，再试其余） */
    preferredLines: string[];
    /** 基准人手倍率（1.0 = 基准，2.0 = 双倍）*/
    headcountMultiplier: number;
    /** 是否允许加班 */
    allowOvertime: boolean;
    /** 是否跳过该订单 */
    skip: boolean;
    /** 跳过原因（可选） */
    skipReason?: string;
}
/**
 * 调用 LLM 获取排产决策。
 *
 * @param orders        通过 step2 校验的有效订单（含 overdueDays）
 * @param lineMapping   客户 → 允许产线列表（{ Amazon: ['4F1'], Shure: ['4F4'] }）
 * @param today         今日日期字符串 'YYYY-MM-DD'
 * @param apiKey        OpenAI API Key
 * @param model         模型名称（如 'gpt-4o-mini'）
 * @param logger        可选日志对象
 * @returns             SchedulingDecision[] 或 null（失败时 fallback）
 */
export declare function fetchLlmDecisions(orders: any[], lineMapping: Record<string, string[]>, today: string, apiKey: string, model: string, logger?: any): Promise<SchedulingDecision[] | null>;
/**
 * 根据 LLM decisions 对有效订单重新排序。
 * 若某订单无对应 decision，保持原位。
 */
export declare function applyLlmOrdering(orders: any[], decisions: SchedulingDecision[]): any[];
