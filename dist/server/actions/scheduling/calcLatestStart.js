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
var calcLatestStart_exports = {};
__export(calcLatestStart_exports, {
  calcLatestStart: () => calcLatestStart
});
module.exports = __toCommonJS(calcLatestStart_exports);
var import_config = require("./config");
function calcLatestStart(capacityPool, linesToTry, uph, totalQty, setupHours, dlvStr, earliestStart, enforceContiguity = true) {
  const hoursNeeded = totalQty / uph + setupHours;
  const dates = [];
  const cur = new Date(earliestStart);
  const end = new Date(dlvStr);
  while (cur <= end) {
    dates.push((0, import_config.formatDate)(cur));
    cur.setDate(cur.getDate() + 1);
  }
  if (enforceContiguity) {
    const primaryLine = linesToTry[0];
    let accumulated = 0;
    for (let i = dates.length - 1; i >= 0; i--) {
      const baseHours = capacityPool.getWorkHoursForDate(dates[i]);
      const avail = capacityPool.getAvailableHours(primaryLine, dates[i]);
      if (baseHours <= 0) {
        continue;
      }
      if (avail <= 0) {
        accumulated = 0;
        continue;
      }
      accumulated += avail;
      if (accumulated >= hoursNeeded) {
        return dates[i];
      }
    }
    return earliestStart;
  }
  const descDates = [...dates].sort((a, b) => a > b ? -1 : a < b ? 1 : 0);
  let accumulatedHours = 0;
  let latestStart = earliestStart;
  for (const dateStr of descDates) {
    for (const line of linesToTry) {
      accumulatedHours += capacityPool.getAvailableHours(line, dateStr);
    }
    latestStart = dateStr;
    if (accumulatedHours >= hoursNeeded) break;
  }
  return latestStart;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  calcLatestStart
});
