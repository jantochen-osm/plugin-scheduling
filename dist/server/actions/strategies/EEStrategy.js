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
var EEStrategy_exports = {};
__export(EEStrategy_exports, {
  EEStrategy: () => EEStrategy
});
module.exports = __toCommonJS(EEStrategy_exports);
var import_config = require("../scheduling/config");
const EE_CONFIG = {
  category: "EE",
  setupTimeHours: 1,
  jitBufferDays: 2,
  // 目标在 dlvDate - 2 天完成
  preferEarlyFinish: false,
  // EE 订单相对独立，按成本最优选择方案
  fallbackLines: ["3F3", "3F4", "3F5", "3F6"],
  lineSelectWeights: {
    capacity: 0.3,
    setupAffinity: 0.5,
    loadBalance: 0.2
  },
  maxHeadcountFactor: 4
  // 最多尝试 4 倍基准人数（+1人/次递增）
};
class EEStrategy {
  name = "EE";
  getConfig() {
    return { ...EE_CONFIG };
  }
  filterOrders(orders) {
    return orders.filter(
      (o) => o.osmCategory === "EE" && import_config.SCHEDULABLE_POOLS.includes(o.prodPoolId)
    );
  }
  getFallbackLines() {
    return [...EE_CONFIG.fallbackLines];
  }
  getActiveStages() {
    return [];
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  EEStrategy
});
