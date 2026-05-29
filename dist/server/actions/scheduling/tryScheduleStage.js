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
var tryScheduleStage_exports = {};
__export(tryScheduleStage_exports, {
  getCombinations: () => getCombinations,
  tryScheduleStage: () => tryScheduleStage
});
module.exports = __toCommonJS(tryScheduleStage_exports);
var import_config = require("./config");
function getCombinations(arr, k) {
  if (k === 0) return [[]];
  if (k > arr.length) return [];
  const result = [];
  function dfs(start, current) {
    if (current.length === k) {
      result.push([...current]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      current.push(arr[i]);
      dfs(i + 1, current);
      current.pop();
    }
  }
  dfs(0, []);
  return result;
}
function tryScheduleStage(mo, linesToTry, capacityPool, allowOvertime, uph, dlvStr, today, lineLastItem, setupTimeHours, startFrom) {
  let remainingQty = mo.qtySched;
  let curDate = startFrom || today;
  let dayCount = 0;
  const dailyPlans = {};
  const extraPlans = {};
  const consumed = [];
  const isFirstDayForLine = {};
  for (const l of linesToTry) {
    dailyPlans[l] = {};
    extraPlans[l] = {};
    isFirstDayForLine[l] = true;
  }
  while (remainingQty > 0 && dayCount < import_config.SCHEDULING_CONFIG.maxDays) {
    const dateStr = typeof curDate === "string" ? curDate : (0, import_config.formatDate)(new Date(curDate));
    let totalRemainingCapacity = 0;
    for (const ln of linesToTry) {
      let d = new Date(dateStr);
      const endDate = new Date(dlvStr);
      while (d <= endDate) {
        totalRemainingCapacity += capacityPool.getAvailableHours(ln, (0, import_config.formatDate)(d));
        d.setDate(d.getDate() + 1);
      }
    }
    const hoursNeeded = remainingQty / uph;
    const isFallingBehind = hoursNeeded > totalRemainingCapacity;
    for (const line of linesToTry) {
      if (remainingQty <= 0) break;
      const remHours = capacityPool.getAvailableHours(line, dateStr);
      let extraHours = 0;
      let setupHoursToConsume = 0;
      if (isFirstDayForLine[line] && lineLastItem[line] !== mo.itemId) {
        setupHoursToConsume = setupTimeHours;
      }
      if (allowOvertime && isFallingBehind) {
        const dayWorkHours = capacityPool.getWorkHoursForDate(dateStr);
        extraHours = Math.min(dayWorkHours, remainingQty / uph + setupHoursToConsume - remHours);
        if (extraHours < 0) extraHours = 0;
      }
      const totalAvailableHours = remHours + extraHours;
      if (totalAvailableHours <= setupHoursToConsume + 0.1) continue;
      const maxQty = (totalAvailableHours - setupHoursToConsume) * uph;
      const qtyToday = remainingQty <= maxQty ? remainingQty : Math.floor(maxQty);
      if (qtyToday <= 0) continue;
      const standardHoursForSetup = Math.min(setupHoursToConsume, remHours);
      const remainingRemHoursForProduction = Math.max(0, remHours - standardHoursForSetup);
      const qtyFromStandard = Math.min(qtyToday, remainingRemHoursForProduction * uph);
      const qtyFromExtra = Math.max(0, qtyToday - qtyFromStandard);
      const standardHoursToConsume = standardHoursForSetup + qtyFromStandard / uph;
      const allocated = capacityPool.allocate(line, dateStr, standardHoursToConsume);
      consumed.push({ line, date: dateStr, hours: allocated });
      dailyPlans[line][dateStr] = qtyToday;
      if (qtyFromExtra > 0) extraPlans[line][dateStr] = qtyFromExtra;
      isFirstDayForLine[line] = false;
      remainingQty -= qtyToday;
    }
    if (remainingQty > 0) {
      curDate = (0, import_config.addDays)(dateStr, 1);
      dayCount++;
    }
  }
  for (const c of consumed) {
    capacityPool.release(c.line, c.date, c.hours);
  }
  let globalStart = "";
  let globalFinish = "";
  for (const line of linesToTry) {
    const dates = Object.keys(dailyPlans[line]).sort();
    if (dates.length > 0) {
      if (!globalStart || dates[0] < globalStart) globalStart = dates[0];
      if (!globalFinish || dates[dates.length - 1] > globalFinish) globalFinish = dates[dates.length - 1];
    }
  }
  const { standardHourRate, overtimeMultiplier, additionalLineMultiplier } = import_config.SCHEDULING_CONFIG.costModel;
  let totalStandardHours = 0;
  let totalOvertimeHours = 0;
  for (const line of linesToTry) {
    for (const dateStr of Object.keys(dailyPlans[line])) {
      const qty = dailyPlans[line][dateStr] || 0;
      const extraQty = extraPlans[line] && extraPlans[line][dateStr] || 0;
      totalStandardHours += Math.max(0, qty - extraQty) / uph;
      totalOvertimeHours += extraQty / uph;
    }
  }
  const extraLines = Math.max(0, linesToTry.length - 1);
  const standardCost = totalStandardHours * standardHourRate;
  const overtimeCost = totalOvertimeHours * standardHourRate * overtimeMultiplier;
  const extraLineCost = extraLines > 0 ? (totalStandardHours + totalOvertimeHours) / linesToTry.length * extraLines * standardHourRate * additionalLineMultiplier : 0;
  return {
    success: remainingQty <= 0,
    remaining: remainingQty,
    startDate: globalStart,
    finishDate: globalFinish,
    dailyPlans,
    extraPlans,
    linesUsed: linesToTry,
    costEstimate: {
      standardHours: Math.round(totalStandardHours * 10) / 10,
      overtimeHours: Math.round(totalOvertimeHours * 10) / 10,
      linesUsedCount: linesToTry.length,
      standardCost: Math.round(standardCost * 10) / 10,
      overtimeCost: Math.round(overtimeCost * 10) / 10,
      extraLineCost: Math.round(extraLineCost * 10) / 10,
      totalCost: Math.round((standardCost + overtimeCost + extraLineCost) * 10) / 10
    }
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getCombinations,
  tryScheduleStage
});
