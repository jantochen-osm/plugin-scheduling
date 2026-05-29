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
var config_exports = {};
__export(config_exports, {
  MOCK_TODAY: () => MOCK_TODAY,
  SCHEDULABLE_POOLS: () => SCHEDULABLE_POOLS,
  SCHEDULING_CONFIG: () => SCHEDULING_CONFIG,
  addDays: () => addDays,
  formatDate: () => formatDate,
  getToday: () => getToday,
  getTodayStr: () => getTodayStr
});
module.exports = __toCommonJS(config_exports);
const MOCK_TODAY = "2026-01-01";
function formatDate(d) {
  return d.toISOString().split("T")[0];
}
function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return formatDate(d);
}
function getToday() {
  return MOCK_TODAY ? /* @__PURE__ */ new Date(MOCK_TODAY + "T00:00:00") : /* @__PURE__ */ new Date();
}
function getTodayStr() {
  return MOCK_TODAY || formatDate(/* @__PURE__ */ new Date());
}
const SCHEDULABLE_POOLS = [
  "SC_YBSC_F3",
  "SC_YBSC_HT",
  "SCD_HT_CC",
  "SCD_HT_F3"
];
const SCHEDULING_CONFIG = {
  /** CapacityPool 初始化时的兜底每日工时（来源：md_work_calendars） */
  defaultWorkHours: 10,
  /** 排产窗口上限（天），防止无限循环 */
  maxDays: 365,
  /** 尾单合并最小阈值（件）：末日产量低于此值时并入前一天 */
  minTailQty: 10,
  /** 交期聚类窗口（天），用于 step3_sort 的 windowIdx 计算 */
  clusterWindowDays: 3,
  /** 成本模型，用于 tryScheduleStage 的方案优选 */
  costModel: {
    standardHourRate: 1,
    overtimeMultiplier: 2.5,
    additionalLineMultiplier: 1.2
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MOCK_TODAY,
  SCHEDULABLE_POOLS,
  SCHEDULING_CONFIG,
  addDays,
  formatDate,
  getToday,
  getTodayStr
});
