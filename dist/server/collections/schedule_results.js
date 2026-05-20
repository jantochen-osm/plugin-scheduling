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
var schedule_results_exports = {};
__export(schedule_results_exports, {
  default: () => schedule_results_default
});
module.exports = __toCommonJS(schedule_results_exports);
var import_database = require("@nocobase/database");
var schedule_results_default = (0, import_database.defineCollection)({
  name: "schedule_results",
  title: "\u6392\u4EA7\u7ED3\u679C",
  filterTargetKey: "id",
  fields: [
    // ── MO 标识 ──
    {
      type: "string",
      name: "prodId",
      title: "\u751F\u4EA7\u5355\u53F7"
    },
    {
      type: "string",
      name: "itemId",
      title: "\u6210\u54C1\u7F16\u7801"
    },
    // ── MO 信息 ──
    {
      type: "integer",
      name: "totalQty",
      title: "\u8BA2\u5355\u6570\u91CF"
    },
    {
      type: "date",
      name: "dlvDate",
      title: "\u4EA4\u671F"
    },
    {
      type: "string",
      name: "prodStatus",
      title: "\u8BA2\u5355\u72B6\u6001"
    },
    {
      type: "string",
      name: "prodPoolId",
      title: "\u8BA2\u5355\u6C60"
    },
    {
      type: "string",
      name: "osmCategory",
      title: "\u54C1\u7C7B"
    },
    // ── 排产汇总 ──
    {
      type: "date",
      name: "startDate",
      title: "\u5F00\u59CB\u65E5"
    },
    {
      type: "date",
      name: "finishDate",
      title: "\u5B8C\u6210\u65E5"
    },
    {
      type: "boolean",
      name: "isOverdue",
      title: "\u662F\u5426\u903E\u671F",
      defaultValue: false
    },
    {
      type: "integer",
      name: "overdueDays",
      title: "\u903E\u671F\u5929\u6570",
      defaultValue: 0
    },
    {
      type: "string",
      name: "overdueType",
      title: "\u903E\u671F\u7C7B\u578B",
      // ON_TIME=按时 | AT_RISK=排产逾期 | PAST_DUE=已过交期
      defaultValue: "ON_TIME"
    },
    {
      type: "string",
      name: "candidateLines",
      title: "\u5019\u9009\u4EA7\u7EBF"
    },
    {
      type: "string",
      name: "chosenLine",
      title: "\u9009\u4E2D\u4EA7\u7EBF"
    },
    // ── 每日排产计划（JSON: {"2026-05-15": 3000, "2026-05-16": 2000}）──
    {
      type: "json",
      interface: "json",
      name: "dailyPlan",
      title: "\u6BCF\u65E5\u6392\u4EA7"
    }
  ]
});
