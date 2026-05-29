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
export declare class ESGStrategy implements SchedulingStrategy {
    readonly name = "ESG";
    getConfig(): SchedulingConfig;
    filterOrders(orders: any[]): any[];
    getFallbackLines(): string[];
    /** ESG 仅排 Assembly 工段 */
    getActiveStages(): string[];
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
    beforeSchedule(orders: any[]): any[];
}
