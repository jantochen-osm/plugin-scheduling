/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var ESGStrategy_exports = {};
__export(ESGStrategy_exports, {
  ESGStrategy: () => ESGStrategy
});
module.exports = __toCommonJS(ESGStrategy_exports);
var import_config = require("../scheduling/config");
const ESG_CONFIG = {
  category: "ESG",
  setupTimeHours: 0,
  // 暂时禁用换型时间损耗（待业务确认后恢复）
  jitBufferDays: 2,
  // 目标在 dlvDate - 2 天完成，给交期留出缓冲
  preferEarlyFinish: true,
  // 顺序排队：当前单尽快完成 = 产线尽早释放 = 后续单越容易准时
  fallbackLines: ["4F1", "4F2", "4F4", "4F6"],
  // 不含 4F3/4F5 试产线
  lineSelectWeights: {
    capacity: 0.3,
    setupAffinity: 0.5,
    loadBalance: 0.2
  },
  maxHeadcountFactor: 4
  // 最多尝试 4 倍基准人数（+1人/次递增）
};
class ESGStrategy {
  name = "ESG";
  getConfig() {
    return { ...ESG_CONFIG };
  }
  filterOrders(orders) {
    return orders.filter(
      (o) => o.osmCategory === "ESG" && import_config.SCHEDULABLE_POOLS.includes(o.prodPoolId)
    );
  }
  getFallbackLines() {
    return [...ESG_CONFIG.fallbackLines];
  }
  /** ESG 仅排 Assembly 工段 */
  getActiveStages() {
    return ["Assembly"];
  }
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
  beforeSchedule(orders) {
    const grouped = /* @__PURE__ */ new Map();
    for (const o of orders) {
      const key = o.keyAccount || "_unknown";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(o);
    }
    for (const [, group] of grouped) {
      group.sort((a, b) => {
        if ((b.overdueDays ?? 0) !== (a.overdueDays ?? 0)) return (b.overdueDays ?? 0) - (a.overdueDays ?? 0);
        return new Date(a.dlvDate).getTime() - new Date(b.dlvDate).getTime();
      });
    }
    const sortedGroups = [...grouped.entries()].sort(([, ga], [, gb]) => {
      const aEarliest = ga.length > 0 ? new Date(ga[0].dlvDate).getTime() : Infinity;
      const bEarliest = gb.length > 0 ? new Date(gb[0].dlvDate).getTime() : Infinity;
      return aEarliest - bEarliest;
    });
    const result = [];
    for (const [, group] of sortedGroups) {
      result.push(...group);
    }
    return result;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ESGStrategy
});
