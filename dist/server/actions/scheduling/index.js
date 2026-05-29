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
var scheduling_exports = {};
__export(scheduling_exports, {
  MOCK_TODAY: () => import_config.MOCK_TODAY,
  SCHEDULING_CONFIG: () => import_config.SCHEDULING_CONFIG,
  addDays: () => import_config.addDays,
  calcLatestStart: () => import_calcLatestStart.calcLatestStart,
  formatDate: () => import_config.formatDate,
  getCombinations: () => import_tryScheduleStage.getCombinations,
  getToday: () => import_config.getToday,
  getTodayStr: () => import_config.getTodayStr,
  scheduleAll: () => import_scheduleAll.scheduleAll,
  step1_fetchOrders: () => import_pipelineSteps.step1_fetchOrders,
  step2_validateAndEnrich: () => import_pipelineSteps.step2_validateAndEnrich,
  step3_sort: () => import_pipelineSteps.step3_sort,
  step4_collectLines: () => import_pipelineSteps.step4_collectLines,
  step5_initCapacityPool: () => import_pipelineSteps.step5_initCapacityPool,
  tryScheduleStage: () => import_tryScheduleStage.tryScheduleStage
});
module.exports = __toCommonJS(scheduling_exports);
var import_config = require("./config");
var import_pipelineSteps = require("./pipelineSteps");
var import_calcLatestStart = require("./calcLatestStart");
var import_tryScheduleStage = require("./tryScheduleStage");
var import_scheduleAll = require("./scheduleAll");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MOCK_TODAY,
  SCHEDULING_CONFIG,
  addDays,
  calcLatestStart,
  formatDate,
  getCombinations,
  getToday,
  getTodayStr,
  scheduleAll,
  step1_fetchOrders,
  step2_validateAndEnrich,
  step3_sort,
  step4_collectLines,
  step5_initCapacityPool,
  tryScheduleStage
});
