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
var schedule_runs_exports = {};
__export(schedule_runs_exports, {
  default: () => schedule_runs_default
});
module.exports = __toCommonJS(schedule_runs_exports);
var import_database = require("@nocobase/database");
var schedule_runs_default = (0, import_database.defineCollection)({
  name: "schedule_runs",
  title: "\u6392\u4EA7\u8FD0\u884C\u8BB0\u5F55",
  filterTargetKey: "id",
  fields: [
    {
      type: "string",
      name: "runId",
      title: "\u8FD0\u884CID",
      unique: true
    },
    {
      type: "date",
      name: "runTime",
      title: "\u8FD0\u884C\u65F6\u95F4"
    },
    {
      type: "string",
      name: "status",
      title: "\u8FD0\u884C\u72B6\u6001",
      // SUCCESS | PARTIAL | FAILED
      defaultValue: "COMPLETED"
    },
    {
      type: "integer",
      name: "totalOrders",
      title: "\u603B\u8BA2\u5355\u6570"
    },
    {
      type: "integer",
      name: "validOrders",
      title: "\u6709\u6548\u8BA2\u5355\u6570"
    },
    {
      type: "integer",
      name: "scheduledCount",
      title: "\u6392\u4EA7\u6210\u529F\u6570"
    },
    {
      type: "integer",
      name: "exceptionCount",
      title: "\u5F02\u5E38\u6570"
    },
    {
      type: "float",
      name: "successRate",
      title: "\u6210\u529F\u7387"
    },
    {
      type: "json",
      interface: "json",
      name: "lineUtilization",
      title: "\u4EA7\u7EBF\u5229\u7528\u7387"
      // 结构: [{ line, totalCapacityHours, usedHours, utilizationRate, orderCount }]
    },
    {
      type: "json",
      interface: "json",
      name: "exceptionBreakdown",
      title: "\u5F02\u5E38\u5206\u5E03"
      // 结构: { PAST_DLV_DATE: 5, MISSING_ROUTE: 2, ... }
    }
  ]
});
