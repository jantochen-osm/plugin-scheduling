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
var adjustResult_exports = {};
__export(adjustResult_exports, {
  adjustResult: () => adjustResult
});
module.exports = __toCommonJS(adjustResult_exports);
const ESG_ALLOWED_LINES = ["4F1", "4F2", "4F4", "4F6"];
async function adjustResult(ctx) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i;
  const body = ((_b = (_a = ctx.action) == null ? void 0 : _a.params) == null ? void 0 : _b.values) ?? ((_c = ctx.request) == null ? void 0 : _c.body) ?? {};
  const {
    id,
    chosenLine,
    startDate,
    finishDate,
    dailyPlanPatch,
    adjustReason
  } = body;
  if (!id) {
    ctx.status = 400;
    ctx.body = { error: "\u7F3A\u5C11\u5FC5\u586B\u53C2\u6570 id" };
    return;
  }
  if (chosenLine && !ESG_ALLOWED_LINES.includes(chosenLine)) {
    ctx.status = 400;
    ctx.body = {
      error: `\u4EA7\u7EBF "${chosenLine}" \u4E0D\u5728 ESG \u5141\u8BB8\u8303\u56F4\u5185\uFF08${ESG_ALLOWED_LINES.join("/")}\uFF09`
    };
    return;
  }
  if (startDate && finishDate && startDate > finishDate) {
    ctx.status = 400;
    ctx.body = { error: `\u5F00\u59CB\u65E5\u671F ${startDate} \u4E0D\u80FD\u665A\u4E8E\u5B8C\u6210\u65E5\u671F ${finishDate}` };
    return;
  }
  if (dailyPlanPatch) {
    for (const [date, qty] of Object.entries(dailyPlanPatch)) {
      if (typeof qty !== "number" || qty < 0) {
        ctx.status = 400;
        ctx.body = { error: `dailyPlanPatch \u4E2D ${date} \u7684\u4EA7\u91CF\u4E0D\u80FD\u4E3A\u8D1F\u6570` };
        return;
      }
    }
  }
  const repo = ctx.db.getRepository("schedule_results_v2");
  let original;
  try {
    original = await repo.findOne({ filterByTk: id });
  } catch (e) {
    ctx.status = 500;
    ctx.body = { error: "\u67E5\u8BE2\u539F\u8BB0\u5F55\u5931\u8D25: " + ((e == null ? void 0 : e.message) ?? String(e)) };
    return;
  }
  if (!original) {
    ctx.status = 404;
    ctx.body = { error: `\u672A\u627E\u5230 id=${id} \u7684\u6392\u4EA7\u8BB0\u5F55` };
    return;
  }
  let newDailyPlan = null;
  if (dailyPlanPatch && Object.keys(dailyPlanPatch).length > 0) {
    const originalPlan = typeof original.dailyPlan === "string" ? JSON.parse(original.dailyPlan || "{}") : original.dailyPlan ?? {};
    newDailyPlan = { ...originalPlan, ...dailyPlanPatch };
    for (const [d, q] of Object.entries(newDailyPlan)) {
      if (q <= 0) delete newDailyPlan[d];
    }
  }
  let derivedStart = startDate;
  let derivedFinish = finishDate;
  if (newDailyPlan && !startDate && !finishDate) {
    const dates = Object.keys(newDailyPlan).sort();
    if (dates.length > 0) {
      derivedStart = dates[0];
      derivedFinish = dates[dates.length - 1];
    }
  }
  try {
    const setClauses = [];
    const replacements = { id };
    if (chosenLine !== void 0) {
      setClauses.push('"chosenLine" = :chosenLine');
      replacements.chosenLine = chosenLine;
    }
    if (derivedStart !== void 0) {
      setClauses.push('"startDate" = :startDate::date');
      replacements.startDate = derivedStart;
    }
    if (derivedFinish !== void 0) {
      setClauses.push('"finishDate" = :finishDate::date');
      replacements.finishDate = derivedFinish;
    }
    if (newDailyPlan !== null) {
      setClauses.push('"dailyPlan" = :dailyPlan::json');
      replacements.dailyPlan = JSON.stringify(newDailyPlan);
    }
    if (adjustReason !== void 0) {
      setClauses.push('"adjustReason" = :adjustReason');
      replacements.adjustReason = adjustReason ?? null;
    }
    setClauses.push('"isManualAdjusted" = true');
    setClauses.push('"adjustedAt" = NOW()');
    if (setClauses.length === 2) {
      ctx.status = 400;
      ctx.body = { error: "\u6CA1\u6709\u63D0\u4F9B\u4EFB\u4F55\u9700\u8981\u8C03\u6574\u7684\u5B57\u6BB5" };
      return;
    }
    await ctx.db.sequelize.query(
      `UPDATE schedule_results_v2
          SET ${setClauses.join(", ")}
        WHERE id = :id`,
      { replacements }
    );
    (_e = (_d = ctx.logger) == null ? void 0 : _d.info) == null ? void 0 : _e.call(_d, `[AdjustResult] id=${id} updated: ${setClauses.join(", ")}`);
  } catch (e) {
    (_h = (_f = ctx.logger) == null ? void 0 : _f.error) == null ? void 0 : _h.call(_f, "[AdjustResult][ERROR] " + (((_g = e == null ? void 0 : e.original) == null ? void 0 : _g.message) ?? (e == null ? void 0 : e.message) ?? String(e)));
    ctx.status = 500;
    ctx.body = { error: "\u66F4\u65B0\u5931\u8D25: " + (((_i = e == null ? void 0 : e.original) == null ? void 0 : _i.message) ?? (e == null ? void 0 : e.message) ?? String(e)) };
    return;
  }
  try {
    const updated = await repo.findOne({ filterByTk: id });
    ctx.body = { success: true, data: updated };
  } catch {
    ctx.body = { success: true, data: { id } };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  adjustResult
});
