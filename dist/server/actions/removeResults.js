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
var removeResults_exports = {};
__export(removeResults_exports, {
  removeResults: () => removeResults
});
module.exports = __toCommonJS(removeResults_exports);
async function removeResults(ctx) {
  var _a, _b, _c, _d, _e;
  const body = ((_b = (_a = ctx.action) == null ? void 0 : _a.params) == null ? void 0 : _b.values) ?? ((_c = ctx.request) == null ? void 0 : _c.body) ?? {};
  const prodIds = body.prodIds;
  if (!Array.isArray(prodIds) || prodIds.length === 0) {
    ctx.throw(400, "prodIds is required and must be a non-empty array");
  }
  const [, meta] = await ctx.db.sequelize.query(
    `DELETE FROM schedule_results_v2 WHERE "prodId" IN (:prodIds)`,
    { replacements: { prodIds } }
  );
  const deleted = (meta == null ? void 0 : meta.rowCount) ?? prodIds.length;
  (_e = (_d = ctx.logger) == null ? void 0 : _d.info) == null ? void 0 : _e.call(_d, `[removeResults] Deleted ${deleted} rows for prodIds: ${prodIds.join(", ")}`);
  ctx.body = {
    success: true,
    deleted,
    prodIds
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  removeResults
});
