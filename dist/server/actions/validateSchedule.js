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
var validateSchedule_exports = {};
__export(validateSchedule_exports, {
  validateSchedule: () => validateSchedule
});
module.exports = __toCommonJS(validateSchedule_exports);
async function validateSchedule(ctx) {
  const resultRepo = ctx.db.getRepository("schedule_results_v2");
  const excRepo = ctx.db.getRepository("schedule_exceptions_v2");
  const calRepo = ctx.db.getRepository("md_work_calendars");
  const routeRepo = ctx.db.getRepository("route_operation");
  const results = await resultRepo.find({ paginate: false });
  const exceptions = await excRepo.find({ paginate: false });
  const calRows = await calRepo.find({ paginate: false });
  const routeRows = await routeRepo.find({ paginate: false });
  const calendarMap = /* @__PURE__ */ new Map();
  for (const r of calRows) {
    const d = r.calendarDate ? new Date(r.calendarDate).toISOString().split("T")[0] : null;
    if (d) {
      calendarMap.set(d, { workHours: Number(r.workHours) || 0, isSchedulable: !!r.isSchedulable });
    }
  }
  const routeMap = /* @__PURE__ */ new Map();
  for (const r of routeRows) {
    const opName = (r.operation_name || "").toLowerCase();
    const uph = Number(r.erp_uph) || 0;
    if (opName.includes("assembly") && uph > 0) {
      routeMap.set(r.fg_item_code, { uph });
    }
  }
  const checks = [];
  {
    const violations = [];
    for (const r of results) {
      if (!r.dailyPlan || !r.uph) continue;
      for (const [date, qty] of Object.entries(r.dailyPlan)) {
        const cal = calendarMap.get(date);
        const maxQty = r.uph * ((cal == null ? void 0 : cal.workHours) || 10);
        if (qty > maxQty * 1.01) {
          violations.push({ prodId: r.prodId, date, detail: `\u4EA7\u91CF ${qty} > \u6700\u5927 ${maxQty} (UPH=${r.uph} \xD7 ${(cal == null ? void 0 : cal.workHours) || 10}h)` });
        }
      }
    }
    checks.push({ rule: "V1", name: "\u4E0D\u8D85\u4EA7", pass: violations.length === 0, violations: violations.slice(0, 20) });
  }
  {
    const violations = [];
    for (const r of results) {
      if (!r.dailyPlan) continue;
      const planned = Object.values(r.dailyPlan).reduce((s, v) => s + v, 0);
      if (Math.abs(planned - r.totalQty) > 1) {
        violations.push({ prodId: r.prodId, detail: `\u6392\u4EA7 ${planned} \u2260 \u8BA2\u5355 ${r.totalQty}, \u5DEE ${planned - r.totalQty}` });
      }
    }
    checks.push({ rule: "V2", name: "\u4E0D\u6F0F\u6392/\u591A\u6392", pass: violations.length === 0, violations: violations.slice(0, 20) });
  }
  {
    const violations = [];
    const prodLineQty = /* @__PURE__ */ new Map();
    for (const r of results) {
      if (!prodLineQty.has(r.prodId)) {
        prodLineQty.set(r.prodId, { lines: /* @__PURE__ */ new Set(), totalPlanned: 0, orderQty: r.totalQty || 0 });
      }
      const entry = prodLineQty.get(r.prodId);
      if (r.chosenLine) entry.lines.add(r.chosenLine);
      if (r.dailyPlan) {
        const lineQty = Object.values(r.dailyPlan).reduce((s, v) => s + v, 0);
        entry.totalPlanned += lineQty;
      }
    }
    for (const [prodId, { lines, totalPlanned, orderQty }] of prodLineQty) {
      if (lines.size > 1 && Math.abs(totalPlanned - orderQty) > 1) {
        violations.push({ prodId, detail: `\u62C6\u5355\u5230 ${lines.size} \u6761\u7EBF (${[...lines].join(", ")})\uFF0C\u603B\u6392\u4EA7 ${totalPlanned} \u2260 \u8BA2\u5355 ${orderQty}` });
      }
    }
    checks.push({ rule: "V3", name: "\u62C6\u5355\u5408\u7406", pass: violations.length === 0, violations });
  }
  {
    const violations = [];
    const lineDay = /* @__PURE__ */ new Map();
    for (const r of results) {
      if (!r.dailyPlan || !r.chosenLine || !r.uph) continue;
      for (const [date, qty] of Object.entries(r.dailyPlan)) {
        const key = `${r.chosenLine}_${date}`;
        lineDay.set(key, (lineDay.get(key) || 0) + qty / r.uph);
      }
    }
    for (const [key, usedHours] of lineDay) {
      const [line, date] = key.split("_");
      const cal = calendarMap.get(date);
      const maxHours = (cal == null ? void 0 : cal.workHours) || 10;
      if (usedHours > maxHours * 1.01) {
        violations.push({ line, date, detail: `\u4F7F\u7528 ${usedHours.toFixed(1)}h > \u65E5\u5386 ${maxHours}h` });
      }
    }
    checks.push({ rule: "V4", name: "\u4E0D\u8D85\u65F6", pass: violations.length === 0, violations: violations.slice(0, 20) });
  }
  {
    const violations = [];
    for (const r of results) {
      if (!r.dailyPlan) continue;
      for (const date of Object.keys(r.dailyPlan)) {
        const cal = calendarMap.get(date);
        if (!cal || !cal.isSchedulable) {
          violations.push({ prodId: r.prodId, date, detail: `\u6392\u5728\u4E86\u4E0D\u53EF\u6392\u4EA7\u65E5` });
        }
      }
    }
    checks.push({ rule: "V5", name: "\u4E0D\u6392\u4F11\u606F\u65E5", pass: violations.length === 0, violations: violations.slice(0, 20) });
  }
  {
    const violations = [];
    for (const r of results) {
      if (!r.dailyPlan) continue;
      for (const [date, qty] of Object.entries(r.dailyPlan)) {
        if (qty < 10 && qty < r.totalQty) {
          violations.push({ prodId: r.prodId, date, detail: `\u65E5\u4EA7\u4EC5 ${qty} \u4E2A (\u603B\u91CF ${r.totalQty})` });
        }
      }
    }
    checks.push({ rule: "V6", name: "\u65E0\u788E\u7247\u6392\u4EA7", pass: violations.length === 0, violations: violations.slice(0, 20) });
  }
  const allPass = checks.every((c) => c.pass);
  const summary = {
    totalResults: results.length,
    totalExceptions: exceptions.length,
    exceptionBreakdown: {}
  };
  for (const e of exceptions) {
    const t = e.exceptionType || "UNKNOWN";
    summary.exceptionBreakdown[t] = (summary.exceptionBreakdown[t] || 0) + 1;
  }
  ctx.body = {
    valid: allPass,
    summary,
    checks
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  validateSchedule
});
