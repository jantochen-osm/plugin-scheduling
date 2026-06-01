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
var listRuns_exports = {};
__export(listRuns_exports, {
  listRuns: () => listRuns
});
module.exports = __toCommonJS(listRuns_exports);
async function listRuns(ctx) {
  var _a;
  const { page = 1, pageSize = 10 } = ((_a = ctx.action) == null ? void 0 : _a.params) ?? {};
  const limit = Math.min(Number(pageSize) || 10, 100);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
  const [rows] = await ctx.db.sequelize.query(
    `SELECT
       "runId", "runTime", status,
       "totalOrders", "validOrders", "scheduledCount", "exceptionCount",
       "successRate", "runMode", "selectedProdIds", "exceptionBreakdown"
     FROM schedule_runs
     ORDER BY "runTime" DESC
     LIMIT :limit OFFSET :offset`,
    { replacements: { limit, offset } }
  );
  const [[{ total }]] = await ctx.db.sequelize.query(
    `SELECT COUNT(*) AS total FROM schedule_runs`
  );
  ctx.body = {
    data: rows,
    meta: {
      total: Number(total),
      page: Number(page),
      pageSize: limit
    }
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  listRuns
});
