/**
 * scheduling/pipelineSteps.ts
 *
 * 排产流水线的五个预处理步骤：
 *   Step 1 — 从数据库拉取所有生产订单
 *   Step 2 — 校验 & 富化（过滤无效单、附加工段信息）
 *   Step 3 — 排序（交期优先 + 聚类窗口）
 *   Step 4 — 收集候选产线（客户映射 + 策略兜底）
 *   Step 5 — 初始化产能池（CapacityPool）
 */
import type { Context } from '@nocobase/actions';
import { RuleEngine, CapacityPool } from '../../engines';
import type { SchedulingStrategy } from '../strategies';
/**
 * 从 dn_production_order_ds 拉取订单。
 * @param prodIds  指定订单 ID 列表（prodid 字段）；不传或空数组 = 全量
 */
export declare function step1_fetchOrders(ctx: Context, prodIds?: string[]): Promise<{
    prodId: any;
    itemId: any;
    qtySched: number;
    dlvDate: any;
    prodStatus: any;
    prodPoolId: any;
    osmCategory: any;
    keyAccount: any;
}[]>;
/**
 * 校验规则（BLOCKER → 进入 exceptions，不排产）：
 *   - dlvDate 为空                              → MISSING_DLV_DATE  BLOCKER
 *   - qtySched ≤ 0                             → INVALID_QTY       BLOCKER
 *   - ESG 订单缺少 keyAccount                  → MISSING_KEY_ACCT  BLOCKER
 *   - dn_operrouteline 无该产品路线            → NO_ROUTE          BLOCKER
 *
 * WARNING（记录但仍参与排产）：
 *   - dlvDate < today（逾期）                  → PAST_DLV_DATE     WARNING
 *     逾期订单在 step3 中获得最高优先级（overdueDays 降序第 1 排序键）
 *
 * 通过校验的订单附加 `_stages: [{ stageName: 'Assembly', stageSequence: 1 }]`
 */
export declare function step2_validateAndEnrich(orders: any[], ctx: Context): Promise<{
    validOrders: any[];
    exceptions: any[];
}>;
/**
 * 四级排序键（优先级从高到低）：
 *   1. overdueDays 降序（已逾期天数越多越紧急）
 *   2. _windowIdx 升序（clusterWindowDays 天为一窗，交期早的窗口优先）
 *   3. itemId 字母升序（同窗口内同品号聚集，减少换型）
 *   4. dlvDate 升序（同品号内交期早的先排）
 */
export declare function step3_sort(orders: any[]): any[];
/**
 * 从 customer_line_mapping 收集所有本次排产涉及的产线；
 * 同时合并策略 fallbackLines，确保物料前缀路由等非客户映射产线也被纳入产能池。
 */
export declare function step4_collectLines(orders: any[], ruleEngine: RuleEngine, strategy: SchedulingStrategy): Promise<string[]>;
export declare function step5_initCapacityPool(ctx: Context, ruleEngine: RuleEngine, lineCodes: string[]): Promise<CapacityPool>;
