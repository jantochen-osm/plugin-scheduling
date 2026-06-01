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
var runScheduling_exports = {};
__export(runScheduling_exports, {
  runScheduling: () => runScheduling
});
module.exports = __toCommonJS(runScheduling_exports);
var import_engines = require("../engines");
var import_strategies = require("./strategies");
var import_scheduling = require("./scheduling");
async function runScheduling(ctx) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _A, _B, _C, _D, _E, _F, _G, _H, _I, _J, _K, _L, _M, _N, _O, _P, _Q, _R, _S, _T, _U;
  const ruleEngine = new import_engines.RuleEngine(ctx);
  const today = (0, import_scheduling.getTodayStr)();
  const body = ((_b = (_a = ctx.action) == null ? void 0 : _a.params) == null ? void 0 : _b.values) ?? {};
  const strategyParam = (body.strategy || ((_d = (_c = ctx.action) == null ? void 0 : _c.params) == null ? void 0 : _d.strategy) || "").toUpperCase();
  const prodIds = Array.isArray(body.prodIds) && body.prodIds.length > 0 ? body.prodIds : void 0;
  const runMode = prodIds ? "SELECTED" : "FULL";
  const strategies = [];
  if (!strategyParam || strategyParam === "EE") strategies.push(new import_strategies.EEStrategy());
  if (!strategyParam || strategyParam === "ESG") strategies.push(new import_strategies.ESGStrategy());
  (_f = (_e = ctx.logger) == null ? void 0 : _e.info) == null ? void 0 : _f.call(_e, `[Init] Strategies: ${strategies.map((s) => s.name).join(", ")} | Mode: ${runMode}${prodIds ? ` (${prodIds.length} orders)` : ""}`);
  const allOrders = await (0, import_scheduling.step1_fetchOrders)(ctx, prodIds);
  (_h = (_g = ctx.logger) == null ? void 0 : _g.info) == null ? void 0 : _h.call(_g, `[Step 1] Loaded ${allOrders.length} orders`);
  const allResults = [];
  const allExc = [];
  const allLineUtil = [];
  {
    const handledIds = /* @__PURE__ */ new Set();
    for (const strategy of strategies) {
      for (const o of strategy.filterOrders(allOrders)) {
        handledIds.add(o.prodId);
      }
    }
    for (const o of allOrders) {
      if (!handledIds.has(o.prodId)) {
        allExc.push({
          prodId: o.prodId,
          itemId: o.itemId,
          exceptionType: "POOL_NOT_SCHEDULABLE",
          severity: "WARNING",
          message: `\u751F\u4EA7\u6C60\u300C${o.prodPoolId || "-"}\u300D\u4E0D\u5728\u5F53\u524D\u6392\u4EA7\u8303\u56F4\uFF08\u4EC5\u652F\u6301\u88C5\u914D\u7C7B\u8BA2\u5355\u6C60\uFF09\uFF0C\u8BA2\u5355\u5DF2\u8DF3\u8FC7`
        });
      }
    }
    if (allExc.length > 0) {
      (_j = (_i = ctx.logger) == null ? void 0 : _i.info) == null ? void 0 : _j.call(_i, `[Step pre] ${allExc.length} orders skipped (pool not schedulable)`);
    }
  }
  for (const strategy of strategies) {
    (_l = (_k = ctx.logger) == null ? void 0 : _k.info) == null ? void 0 : _l.call(_k, `--- Strategy: ${strategy.name} ---`);
    const candidateOrders = strategy.filterOrders(allOrders);
    (_n = (_m = ctx.logger) == null ? void 0 : _m.info) == null ? void 0 : _n.call(_m, `  Filtered: ${candidateOrders.length} orders`);
    const { validOrders, exceptions: valEx } = await (0, import_scheduling.step2_validateAndEnrich)(candidateOrders, ctx);
    (_p = (_o = ctx.logger) == null ? void 0 : _o.info) == null ? void 0 : _p.call(_o, `  Valid: ${validOrders.length}, Exceptions: ${valEx.length}`);
    allExc.push(...valEx);
    if (validOrders.length === 0) continue;
    let sortedOrders = (0, import_scheduling.step3_sort)(validOrders);
    if (strategy.beforeSchedule) {
      sortedOrders = strategy.beforeSchedule(sortedOrders);
    }
    const lineCodes = await (0, import_scheduling.step4_collectLines)(sortedOrders, ruleEngine, strategy);
    (_r = (_q = ctx.logger) == null ? void 0 : _q.info) == null ? void 0 : _r.call(_q, `  Lines: ${lineCodes.join(", ")}`);
    const capacityPool = await (0, import_scheduling.step5_initCapacityPool)(ctx, ruleEngine, lineCodes);
    const { results, exceptions: schedEx, lineUtilization } = await (0, import_scheduling.scheduleAll)(
      sortedOrders,
      ruleEngine,
      lineCodes,
      capacityPool,
      ctx,
      strategy
    );
    allResults.push(...results);
    allExc.push(...schedEx);
    allLineUtil.push(...lineUtilization);
    (_t = (_s = ctx.logger) == null ? void 0 : _s.info) == null ? void 0 : _t.call(_s, `  Results: ${results.length}, Exceptions: ${schedEx.length}`);
  }
  let globalStartDate = "";
  let globalEndDate = "";
  if (allResults.length > 0) {
    const starts = allResults.map((r) => r.startDate).filter(Boolean).sort();
    const ends = allResults.map((r) => r.finishDate).filter(Boolean).sort();
    globalStartDate = starts[0] || "";
    globalEndDate = ends[ends.length - 1] || "";
  }
  const runId = `RUN_${Date.now()}`;
  const resultRepo = ctx.db.getRepository("schedule_results_v2");
  const excRepo = ctx.db.getRepository("schedule_exceptions_v2");
  try {
    const oldResults = await resultRepo.find({ fields: ["id"], paginate: false });
    if (oldResults.length > 0) await resultRepo.destroy({ filterByTk: oldResults.map((r) => r.id) });
    (_v = (_u = ctx.logger) == null ? void 0 : _u.info) == null ? void 0 : _v.call(_u, "[DB] Full mode: cleared all schedule_results_v2");
  } catch (e) {
    (_y = (_w = ctx.logger) == null ? void 0 : _w.error) == null ? void 0 : _y.call(_w, "[DB][ERROR] Clear results_v2: " + (((_x = e == null ? void 0 : e.original) == null ? void 0 : _x.message) || (e == null ? void 0 : e.message) || e));
    throw e;
  }
  try {
    const oldExcs = await excRepo.find({ fields: ["id"], paginate: false });
    if (oldExcs.length > 0) await excRepo.destroy({ filterByTk: oldExcs.map((r) => r.id) });
    (_A = (_z = ctx.logger) == null ? void 0 : _z.info) == null ? void 0 : _A.call(_z, "[DB] Cleared old exceptions");
  } catch (e) {
    (_D = (_B = ctx.logger) == null ? void 0 : _B.error) == null ? void 0 : _D.call(_B, "[DB][ERROR] Clear exceptions_v2: " + (((_C = e == null ? void 0 : e.original) == null ? void 0 : _C.message) || (e == null ? void 0 : e.message) || e));
    throw e;
  }
  const excSummary = {};
  for (const e of allExc) {
    const t = e.exceptionType || "UNKNOWN";
    excSummary[t] = (excSummary[t] || 0) + 1;
  }
  const exceptionBreakdown = {
    summary: excSummary,
    details: allExc.map((e) => ({
      prodId: e.prodId || "",
      itemId: e.itemId || "",
      exceptionType: e.exceptionType || "UNKNOWN",
      severity: e.severity || "WARNING",
      message: e.message || ""
    }))
  };
  const runStatus = allExc.filter((e) => e.severity === "BLOCKER").length === 0 ? "SUCCESS" : "PARTIAL";
  const validCount = strategies.reduce((sum, s) => sum + s.filterOrders(allOrders).length, 0);
  try {
    await ctx.db.sequelize.query(
      `INSERT INTO schedule_runs
        ("runId", "runTime", status, "totalOrders", "validOrders", "scheduledCount", "exceptionCount",
         "successRate", "lineUtilization", "exceptionBreakdown", "selectedProdIds", "runMode")
       VALUES (:runId, NOW(), :status, :totalOrders, :validOrders, :scheduledCount, :exceptionCount,
               :successRate, :lineUtilization::json, :exceptionBreakdown::json,
               :selectedProdIds::json, :runMode)`,
      {
        replacements: {
          runId,
          status: runStatus,
          totalOrders: allOrders.length,
          validOrders: validCount,
          scheduledCount: allResults.length,
          exceptionCount: allExc.length,
          successRate: allResults.length > 0 ? 100 : 0,
          lineUtilization: JSON.stringify(allLineUtil),
          exceptionBreakdown: JSON.stringify(exceptionBreakdown),
          selectedProdIds: prodIds ? JSON.stringify(prodIds) : null,
          runMode
        }
      }
    );
    (_F = (_E = ctx.logger) == null ? void 0 : _E.info) == null ? void 0 : _F.call(_E, "[DB] Inserted schedule_runs record");
  } catch (e) {
    (_I = (_G = ctx.logger) == null ? void 0 : _G.error) == null ? void 0 : _I.call(_G, "[DB][ERROR] Insert schedule_runs: " + (((_H = e == null ? void 0 : e.original) == null ? void 0 : _H.message) || (e == null ? void 0 : e.message) || String(e)));
    throw e;
  }
  if (allResults.length > 0) {
    try {
      const rows = allResults.map((r) => ({
        runId,
        prodId: r.prodId ?? null,
        itemId: r.itemId ?? null,
        totalQty: r.totalQty ?? null,
        dlvDate: r.dlvDate ?? null,
        prodStatus: r.prodStatus ?? null,
        prodPoolId: r.prodPoolId ?? null,
        osmCategory: r.osmCategory ?? null,
        startDate: r.startDate ?? null,
        finishDate: r.finishDate ?? null,
        isOverdue: r.isOverdue ?? false,
        overdueDays: r.overdueDays ?? 0,
        overdueType: r.overdueType ?? null,
        candidateLines: r.candidateLines ?? null,
        chosenLine: r.chosenLine ?? null,
        uph: r.uph ?? null,
        headcount: r.headcount ?? null,
        dailyPlan: JSON.stringify(r.dailyPlan ?? {}),
        dailyPlanDetail: JSON.stringify(r.dailyPlanDetail ?? {})
      }));
      for (const row of rows) {
        await ctx.db.sequelize.query(
          `INSERT INTO schedule_results_v2
            ("runId", "prodId", "itemId", "totalQty", "dlvDate", "prodStatus", "prodPoolId", "osmCategory",
             "startDate", "finishDate", "isOverdue", "overdueDays", "overdueType",
             "candidateLines", "chosenLine", uph, headcount, "dailyPlan", "dailyPlanDetail")
           VALUES
            (:runId, :prodId, :itemId, :totalQty, :dlvDate::date, :prodStatus, :prodPoolId, :osmCategory,
             :startDate::date, :finishDate::date, :isOverdue, :overdueDays, :overdueType,
             :candidateLines, :chosenLine, :uph, :headcount, :dailyPlan::json, :dailyPlanDetail::json)`,
          { replacements: row }
        );
      }
      (_K = (_J = ctx.logger) == null ? void 0 : _J.info) == null ? void 0 : _K.call(_J, "[DB] Inserted " + allResults.length + " results via raw SQL");
    } catch (e) {
      (_N = (_L = ctx.logger) == null ? void 0 : _L.error) == null ? void 0 : _N.call(_L, "[DB][ERROR] Insert schedule_results_v2: " + (((_M = e == null ? void 0 : e.original) == null ? void 0 : _M.message) || (e == null ? void 0 : e.message) || String(e)));
      throw e;
    }
  }
  if (allExc.length > 0) {
    try {
      await excRepo.create({ values: allExc.map((e) => ({ ...e, runId })) });
      (_P = (_O = ctx.logger) == null ? void 0 : _O.info) == null ? void 0 : _P.call(_O, "[DB] Inserted " + allExc.length + " exceptions");
    } catch (e) {
      (_S = (_Q = ctx.logger) == null ? void 0 : _Q.error) == null ? void 0 : _S.call(_Q, "[DB][ERROR] Insert exceptions_v2: " + (((_R = e == null ? void 0 : e.original) == null ? void 0 : _R.message) || (e == null ? void 0 : e.message) || String(e)));
      throw e;
    }
  }
  (_U = (_T = ctx.logger) == null ? void 0 : _T.info) == null ? void 0 : _U.call(_T, `[Done] ${allResults.length} results, ${allExc.length} exceptions`);
  ctx.body = {
    runId,
    strategies: strategies.map((s) => s.name),
    totalOrders: allOrders.length,
    scheduledCount: allResults.length,
    exceptionCount: allExc.length,
    globalStartDate,
    globalEndDate,
    exceptions: allExc,
    lineUtilization: allLineUtil
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runScheduling
});
