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
var import_path = require("path");
class PluginSchedulingServer extends import_server.Plugin {
  async beforeLoad() {
    // Collections (production_stages, product_stage_mapping, customer_line_mapping,
    // calendar_exceptions) are created via NocoBase admin UI or REST API.
    // They are NOT registered here via db.import() to ensure they appear in the
    // admin collection manager as user-managed collections.
  }
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
    const ProductStageMapping = db.getRepository("product_stage_mapping");
    if (ProductStageMapping && await ProductStageMapping.count() === 0) {
      await ProductStageMapping.create({
        values: [
          { productCode: "FA014A02", stageName: "Assembly", candidateLines: ["3F3", "3F4", "3F5", "3F6"], isFixed: false },
          { productCode: "FA014A02", stageName: "Package", candidateLines: ["1F1", "1F2", "1F3"], isFixed: false },
          { productCode: "FA015B01", stageName: "Assembly", candidateLines: ["ESG_LINE_1", "ESG_LINE_2"], isFixed: false },
          { productCode: "FA015B01", stageName: "Package", candidateLines: ["ESG_LINE_1"], isFixed: true }
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
        validate: import_validateSchedule.validateSchedule
      }
    });
    this.app.acl.allow("scheduling", ["run", "validate"], "loggedIn");
    this.app.acl.allow("schedule_runs", ["list", "get"], "loggedIn");
    this.app.acl.allow("schedule_results_v2", ["list", "get"], "loggedIn");
    this.app.acl.allow("schedule_exceptions_v2", ["list", "get"], "loggedIn");
  }
}
var plugin_default = PluginSchedulingServer;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PluginSchedulingServer
});
