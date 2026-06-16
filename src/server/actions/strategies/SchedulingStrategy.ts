/**
 * SchedulingStrategy — 排产策略接口
 *
 * EE 和 ESG 在订单筛选、默认产线、客户规则上差异显著，
 * 通过策略模式将差异封装，runScheduling 只负责编排。
 */

export interface SchedulingConfig {
  /** 品类标识 */
  category: string;
  /** 换线惩罚时间（小时），0 表示不计换型损耗 */
  setupTimeHours: number;
  /**
   * JIT 安全缓冲天数。
   * 排产目标：订单在 dlvDate - jitBufferDays 当天完成，
   * 给交期前留出 1-2 天缓冲，防止尾端风险。
   * 产线排队紧张时自动退化为 ASAP（从产线空闲日立即开始）。
   */
  jitBufferDays: number;
  /**
   * 方案优选准则：在交期内的多个候选方案中，优先选最早完成（ESG）还是最低成本（EE）。
   *
   * true  — 最早完成日优先（ESG）：
   *           在顺序排队场景下，当前订单尽快完成 = 产线尽早释放 =
   *           后续订单起始日越早 = 整体按时交付率最高。
   *           系统会主动选择加班方案，即使加班对当前订单并非必须。
   *
   * false — 最低成本优先（EE）：
   *           订单相对独立，不需要为后续订单减少占用时间，按成本最优即可。
   */
  preferEarlyFinish: boolean;
  /** 兜底产线（产品无工段映射时使用） */
  fallbackLines: string[];
  /** 选线权重 */
  lineSelectWeights: {
    capacity: number;
    setupAffinity: number;
    loadBalance: number;
    /** 产线衔接度权重（前单完成日越接近本单开始日，得分越高）*/
    continuity: number;
  };
  /**
   * 人手增加上限（相对于工艺路线基准人数的倍数）。
   *
   * 当产能不足时，算法按人数逐步增加（每次 +1 人）直到满足交期或达到上限。
   * 例如：baseHeadcount=1, maxHeadcountFactor=4 → 最多尝试 1、2、3、4 人。
   *
   * 默认值：4（最多 4 倍基准人数）
   */
  maxHeadcountFactor?: number;
  /**
   * 提前开工最大天数（从 JIT 基准日向前偏移，不超此值）。
   * 0 = 严格 JIT；7 = 最多提前一周开工。
   * 与 jitBufferDays 合并：提前量从 bufferDlv 计算，交期缓冲始终保留。
   */
  earlyStartMaxDays?: number;
}


export interface SchedulingStrategy {
  /** 策略名称 */
  readonly name: string;

  /** 获取品类配置 */
  getConfig(): SchedulingConfig;

  /**
   * 筛选候选订单
   * @param orders   全量订单（已从 dn_production_order_ds 拉取）
   * @param poolSet  可排产订单池 ID 集合（由调用方一次性预加载）
   * @returns 该策略关注的订单子集
   */
  filterOrders(orders: any[], poolSet: Set<string>): any[];

  /**
   * 获取该品类的兜底产线（产品无工段映射时）
   * 返回同步数组。ESG 产线的动态加载由调用方通过 ruleEngine.getESGFallbackLines() 处理,
   * 不经过此接口。
   */
  getFallbackLines(): string[];

  /**
   * 获取需要排产的工段名称列表
   * 默认：全部工段。ESG 覆盖为仅 Assembly。
   */
  getActiveStages(): string[];

  /**
   * 订单排产前的预处理（可选钩子）
   * 例如：ESG 可能需要按 keyAccount 分组优先级
   */
  beforeSchedule?(orders: any[]): any[];
}
