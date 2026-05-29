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
var StageDependencyManager_exports = {};
__export(StageDependencyManager_exports, {
  StageDependencyManager: () => StageDependencyManager
});
module.exports = __toCommonJS(StageDependencyManager_exports);
class StageDependencyManager {
  /** orderId → stageName → completionDate */
  completions = /* @__PURE__ */ new Map();
  /** 工段序列定义 (stageName → stageSequence) */
  stageSequenceMap = /* @__PURE__ */ new Map();
  // ─── 工段定义 ───
  /** 注册工段序列（应从 production_stages 加载） */
  registerStages(stages) {
    for (const s of stages) {
      this.stageSequenceMap.set(s.stageName, s.stageSequence);
    }
  }
  /** 获取所有已注册工段（按 sequence 排序） */
  getStagesInOrder() {
    return [...this.stageSequenceMap.entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name);
  }
  // ─── 工段完成记录 ───
  /** 记录某订单某工段的完成日期 */
  recordStageCompletion(orderId, stageName, completionDate) {
    if (!this.completions.has(orderId)) {
      this.completions.set(orderId, /* @__PURE__ */ new Map());
    }
    this.completions.get(orderId).set(stageName, completionDate);
  }
  /** 获取某订单下一工段的最早开始日 */
  getEarliestStartForNextStage(orderId) {
    const orderCompletions = this.completions.get(orderId);
    if (!orderCompletions || orderCompletions.size === 0) return null;
    let maxSeq = -1;
    let latestDate = "";
    for (const [stageName, date] of orderCompletions) {
      const seq = this.stageSequenceMap.get(stageName) ?? 0;
      if (seq > maxSeq || seq === maxSeq && date > latestDate) {
        maxSeq = seq;
        latestDate = date;
      }
    }
    if (!latestDate) return null;
    const d = new Date(latestDate);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  }
  /** 获取某订单某工段的前序工段完成日期 */
  getPreviousStageCompletion(orderId, stageName) {
    const orderCompletions = this.completions.get(orderId);
    if (!orderCompletions) return null;
    const currentSeq = this.stageSequenceMap.get(stageName) ?? 0;
    if (currentSeq <= 1) return null;
    for (const [name, date] of orderCompletions) {
      const seq = this.stageSequenceMap.get(name) ?? 0;
      if (seq === currentSeq - 1) return date;
    }
    return null;
  }
  /** 判断某订单是否所有工段已完成 */
  isOrderComplete(orderId) {
    const orderCompletions = this.completions.get(orderId);
    if (!orderCompletions) return false;
    return orderCompletions.size >= this.stageSequenceMap.size;
  }
  /** 获取某订单的最终完成日期 */
  getOrderCompletionDate(orderId) {
    const orderCompletions = this.completions.get(orderId);
    if (!orderCompletions || orderCompletions.size === 0) return null;
    let latestDate = "";
    for (const date of orderCompletions.values()) {
      if (date > latestDate) latestDate = date;
    }
    return latestDate || null;
  }
  /** 获取某订单的依赖链（从第一工段到最后已完成工段） */
  getDependencyChain(orderId) {
    const orderCompletions = this.completions.get(orderId);
    if (!orderCompletions) return [];
    const stages = this.getStagesInOrder();
    const chain = [];
    for (const stageName of stages) {
      const date = orderCompletions.get(stageName);
      if (date) {
        chain.push({
          orderId,
          stageName,
          stageSequence: this.stageSequenceMap.get(stageName) ?? 0,
          completionDate: date
        });
      }
    }
    return chain;
  }
  /** 清空所有完成记录 */
  reset() {
    this.completions.clear();
  }
  /** 清空指定订单的记录 */
  resetOrder(orderId) {
    this.completions.delete(orderId);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  StageDependencyManager
});
