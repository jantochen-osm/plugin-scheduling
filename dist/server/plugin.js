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
var plugin_exports = {};
__export(plugin_exports, {
  PluginSchedulingServer: () => PluginSchedulingServer,
  default: () => plugin_default
});
module.exports = __toCommonJS(plugin_exports);
var import_server = require("@nocobase/server");
var import_runScheduling = require("./actions/runScheduling");
var import_validateSchedule = require("./actions/validateSchedule");
var import_adjustResult = require("./actions/adjustResult");
class PluginSchedulingServer extends import_server.Plugin {
  async beforeLoad() {
  }
  async install() {
    console.log("Seeding initial data for Task 1.1...");
    const db = this.app.db;
    const ProductionStages = db.getRepository("production_stages");
    if (ProductionStages && await ProductionStages.count() === 0) {
      await ProductionStages.create({
        values: [
          { stageId: "STAGE_001", stageName: "Assembly", stageSequence: 1, remarks: "SMT & Assembly" },
          { stageId: "STAGE_002", stageName: "Package", stageSequence: 2, remarks: "Packaging" }
        ]
      });
    }
    const CustomerLineMapping = db.getRepository("customer_line_mapping");
    if (CustomerLineMapping && await CustomerLineMapping.count() === 0) {
      await CustomerLineMapping.create({
        values: [
          { keyAccount: "CUST_A", osmCategory: "ESG", assignedLines: ["ESG_LINE_1"] },
          { keyAccount: "CUST_B", osmCategory: "ESG", assignedLines: ["ESG_LINE_1", "ESG_LINE_2"] }
        ]
      });
    }
    const CalendarExceptions = db.getRepository("calendar_exceptions");
    if (CalendarExceptions && await CalendarExceptions.count() === 0) {
      await CalendarExceptions.create({
        values: [
          { exceptionDate: "2026-06-01", exceptionType: "HOLIDAY", affectedLines: null, workHours: 0, setupTime: 0, remarks: "Childrens Day" },
          { exceptionDate: "2026-06-05", exceptionType: "MAINTENANCE", affectedLines: ["3F3"], workHours: 8, setupTime: 0, remarks: "Monthly maintenance" },
          { exceptionDate: "2026-06-06", exceptionType: "CHANGEOVER", affectedLines: ["1F1"], workHours: 10, setupTime: 120, remarks: "Product switch" }
        ]
      });
    }
  }
  async load() {
    this.app.resourceManager.define({
      name: "scheduling",
      actions: {
        run: import_runScheduling.runScheduling,
        validate: import_validateSchedule.validateSchedule,
        adjustResult: import_adjustResult.adjustResult
        // 人工调整排产结果
      }
    });
    this.app.acl.allow("scheduling", ["run", "validate", "adjustResult"], "loggedIn");
    this.app.acl.allow("schedule_runs", ["list", "get"], "loggedIn");
    this.app.acl.allow("schedule_results_v2", ["list", "get", "update"], "loggedIn");
    this.app.acl.allow("schedule_exceptions_v2", ["list", "get"], "loggedIn");
  }
}
var plugin_default = PluginSchedulingServer;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PluginSchedulingServer
});
