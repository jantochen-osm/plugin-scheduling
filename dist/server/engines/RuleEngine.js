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
var RuleEngine_exports = {};
__export(RuleEngine_exports, {
  RuleEngine: () => RuleEngine
});
module.exports = __toCommonJS(RuleEngine_exports);
class RuleEngine {
  ctx;
  // 缓存
  customerLineCache = null;
  calendarExceptionCache = null;
  workCalendarCache = null;
  weights;
  constructor(ctx, weights) {
    this.ctx = ctx;
    this.weights = {
      capacity: (weights == null ? void 0 : weights.capacity) ?? 0.3,
      setupAffinity: (weights == null ? void 0 : weights.setupAffinity) ?? 0.5,
      loadBalance: (weights == null ? void 0 : weights.loadBalance) ?? 0.2
    };
  }
  // ─── 公开查询方法 ───
  /** 获取客户分配的产线 */
  async getCustomerLines(keyAccount) {
    await this.ensureCustomerLineCache();
    return this.customerLineCache.get(keyAccount) ?? null;
  }
  /** 获取指定日期的日历异常（null = 无异常） */
  async getCalendarException(date) {
    await this.ensureCalendarExceptionCache();
    return this.calendarExceptionCache.get(date) ?? null;
  }
  /** 获取指定日期的工作日历（产线无关的基础日历） */
  async getWorkCalendarDay(date) {
    await this.ensureWorkCalendarCache();
    return this.workCalendarCache.get(date) ?? null;
  }
  /** 获取选线权重 */
  getLineSelectWeights() {
    return { ...this.weights };
  }
  /** 强制刷新所有缓存 */
  invalidateCache() {
    this.customerLineCache = null;
    this.calendarExceptionCache = null;
    this.workCalendarCache = null;
  }
  // ─── 内部加载方法 ───
  async ensureCustomerLineCache() {
    if (this.customerLineCache !== null) return;
    const repo = this.ctx.db.getRepository("customer_line_mapping");
    const rows = await repo.find({ paginate: false });
    this.customerLineCache = /* @__PURE__ */ new Map();
    for (const r of rows) {
      this.customerLineCache.set(r.keyAccount, {
        keyAccount: r.keyAccount,
        osmCategory: r.osmCategory,
        assignedLines: Array.isArray(r.assignedLines) ? r.assignedLines : []
      });
    }
  }
  async ensureCalendarExceptionCache() {
    if (this.calendarExceptionCache !== null) return;
    const repo = this.ctx.db.getRepository("calendar_exceptions");
    const rows = await repo.find({ paginate: false });
    this.calendarExceptionCache = /* @__PURE__ */ new Map();
    for (const r of rows) {
      const dateStr = r.exceptionDate instanceof Date ? r.exceptionDate.toISOString().split("T")[0] : String(r.exceptionDate).split("T")[0];
      this.calendarExceptionCache.set(dateStr, {
        exceptionDate: dateStr,
        exceptionType: r.exceptionType,
        affectedLines: r.affectedLines ?? null,
        workHours: Number(r.workHours) ?? 0,
        setupTime: Number(r.setupTime) ?? 0,
        remarks: r.remarks
      });
    }
  }
  async ensureWorkCalendarCache() {
    if (this.workCalendarCache !== null) return;
    const repo = this.ctx.db.getRepository("md_work_calendars");
    const rows = await repo.find({ paginate: false });
    this.workCalendarCache = /* @__PURE__ */ new Map();
    for (const r of rows) {
      const dateStr = r.calendarDate instanceof Date ? r.calendarDate.toISOString().split("T")[0] : String(r.calendarDate || "").split("T")[0];
      if (!dateStr) continue;
      this.workCalendarCache.set(dateStr, {
        calendarDate: dateStr,
        isWorkday: !!r.isWorkday,
        isSchedulable: !!r.isSchedulable,
        workHours: Number(r.workHours) || 0,
        dayOfWeek: Number(r.dayOfWeek) || 0
      });
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  RuleEngine
});
