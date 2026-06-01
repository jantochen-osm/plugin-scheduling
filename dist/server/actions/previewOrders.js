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
var previewOrders_exports = {};
__export(previewOrders_exports, {
  previewOrders: () => previewOrders
});
module.exports = __toCommonJS(previewOrders_exports);
async function previewOrders(ctx) {
  var _a, _b, _c;
  const body = ((_b = (_a = ctx.action) == null ? void 0 : _a.params) == null ? void 0 : _b.values) ?? ((_c = ctx.request) == null ? void 0 : _c.body) ?? {};
  const { strategy, dlvDateFrom, dlvDateTo, keyAccount } = body;
  const filter = {};
  if (strategy && strategy.toUpperCase() !== "") {
    filter.osm_category = strategy.toUpperCase();
  }
  if (dlvDateFrom || dlvDateTo) {
    filter.dlvdate = {};
    if (dlvDateFrom) filter.dlvdate.$gte = dlvDateFrom;
    if (dlvDateTo) filter.dlvdate.$lte = dlvDateTo;
  }
  if (keyAccount) {
    filter.keyaccount = keyAccount;
  }
  const repo = ctx.db.getRepository("dn_production_order_ds");
  const rows = await repo.find({
    paginate: false,
    filter: Object.keys(filter).length > 0 ? filter : void 0,
    sort: ["dlvdate"]
    // 按交期升序，与排产优先级一致
  });
  const orders = rows.map((r) => ({
    prodId: r.prodid,
    itemId: r.itemid,
    qtySched: Number(r.qtysched) || 0,
    dlvDate: r.dlvdate instanceof Date ? r.dlvdate.toISOString().split("T")[0] : r.dlvdate ? String(r.dlvdate).split("T")[0] : "",
    prodStatus: r.prodstatus,
    prodPoolId: r.prodpoolid,
    osmCategory: r.osm_category,
    keyAccount: r.keyaccount || ""
  }));
  ctx.body = {
    orders,
    total: orders.length
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  previewOrders
});
