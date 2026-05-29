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
var pipelineSteps_exports = {};
__export(pipelineSteps_exports, {
  step1_fetchOrders: () => step1_fetchOrders,
  step2_validateAndEnrich: () => step2_validateAndEnrich,
  step3_sort: () => step3_sort,
  step4_collectLines: () => step4_collectLines,
  step5_initCapacityPool: () => step5_initCapacityPool
});
module.exports = __toCommonJS(pipelineSteps_exports);
var import_engines = require("../../engines");
var import_config = require("./config");
async function step1_fetchOrders(ctx) {
  const repo = ctx.db.getRepository("dn_production_order_ds");
  const rows = await repo.find({ paginate: false });
  return rows.map((r) => ({
    prodId: r.prodid,
    itemId: r.itemid,
    qtySched: Number(r.qtysched) || 0,
    // 统一归一化为 'YYYY-MM-DD'，避免 UTC 时区 off-by-one
    dlvDate: r.dlvdate instanceof Date ? r.dlvdate.toISOString().split("T")[0] : r.dlvdate ? String(r.dlvdate).split("T")[0] : "",
    prodStatus: r.prodstatus,
    prodPoolId: r.prodpoolid,
    osmCategory: r.osm_category,
    keyAccount: r.keyaccount || ""
  }));
}
async function step2_validateAndEnrich(orders, ctx) {
  const valid = [];
  const exceptions = [];
  const today = (0, import_config.getToday)();
  today.setHours(0, 0, 0, 0);
  for (const mo of orders) {
    if (!mo.dlvDate) {
      exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: "MISSING_DLV_DATE", severity: "BLOCKER", message: "DlvDate is empty" });
      continue;
    }
    if (new Date(mo.dlvDate) < today) {
      exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: "PAST_DLV_DATE", severity: "BLOCKER", message: `DlvDate=${mo.dlvDate} past due` });
      continue;
    }
    if (mo.qtySched <= 0) {
      exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: "INVALID_QTY", severity: "BLOCKER", message: `QtySched=${mo.qtySched}` });
      continue;
    }
    if (mo.osmCategory === "ESG" && !mo.keyAccount) {
      exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: "MISSING_KEY_ACCOUNT", severity: "BLOCKER", message: "ESG order missing keyAccount" });
      continue;
    }
    const routeRepo = ctx.db.getRepository("dn_operrouteline");
    const hasRoute = await routeRepo.count({ filter: { item: mo.itemId, status: 1 } });
    if (!hasRoute) {
      exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: "NO_ROUTE", severity: "BLOCKER", message: `No route for ${mo.itemId}` });
      continue;
    }
    valid.push({ ...mo, _stages: [{ stageName: "Assembly", stageSequence: 1 }] });
  }
  return { validOrders: valid, exceptions };
}
function step3_sort(orders) {
  const windowDays = import_config.SCHEDULING_CONFIG.clusterWindowDays;
  const today = (0, import_config.getToday)();
  today.setHours(0, 0, 0, 0);
  const enriched = orders.map((o) => {
    const dlvTime = new Date(o.dlvDate).getTime();
    const overdueMs = today.getTime() - dlvTime;
    const overdueDays = overdueMs > 0 ? Math.ceil(overdueMs / 864e5) : 0;
    return { ...o, _dlvTime: dlvTime, overdueDays };
  });
  enriched.sort((a, b) => a._dlvTime - b._dlvTime);
  const baseTime = enriched.length > 0 ? enriched[0]._dlvTime : 0;
  const windowMs = windowDays * 864e5;
  for (const o of enriched) {
    o._windowIdx = Math.floor((o._dlvTime - baseTime) / windowMs);
  }
  return enriched.sort((a, b) => {
    if (a.overdueDays !== b.overdueDays) return b.overdueDays - a.overdueDays;
    if (a._windowIdx !== b._windowIdx) return a._windowIdx - b._windowIdx;
    if (a.itemId !== b.itemId) return a.itemId < b.itemId ? -1 : 1;
    return a._dlvTime - b._dlvTime;
  });
}
async function step4_collectLines(orders, ruleEngine, strategy) {
  const lineSet = /* @__PURE__ */ new Set();
  for (const mo of orders) {
    if (mo.keyAccount) {
      const mapping = await ruleEngine.getCustomerLines(mo.keyAccount);
      if (mapping) {
        for (const line of mapping.assignedLines) lineSet.add(line);
      }
    }
  }
  for (const line of strategy.getFallbackLines()) {
    lineSet.add(line);
  }
  return [...lineSet].sort();
}
async function step5_initCapacityPool(ctx, ruleEngine, lineCodes) {
  const pool = new import_engines.CapacityPool(ruleEngine, import_config.SCHEDULING_CONFIG.defaultWorkHours);
  const today = (0, import_config.getTodayStr)();
  const endDate = (0, import_config.addDays)(today, import_config.SCHEDULING_CONFIG.maxDays);
  await pool.init(lineCodes, today, endDate);
  return pool;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  step1_fetchOrders,
  step2_validateAndEnrich,
  step3_sort,
  step4_collectLines,
  step5_initCapacityPool
});
