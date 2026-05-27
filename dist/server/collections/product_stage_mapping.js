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
var product_stage_mapping_exports = {};
__export(product_stage_mapping_exports, {
  default: () => product_stage_mapping_default
});
module.exports = __toCommonJS(product_stage_mapping_exports);
var import_database = require("@nocobase/database");
var product_stage_mapping_default = (0, import_database.defineCollection)({
  name: "product_stage_mapping",
  title: "\u4EA7\u54C1\u5DE5\u6BB5\u6620\u5C04",
  dumpRules: "required",
  shared: true,
  filterTargetKey: "id",
  fields: [
    {
      type: "string",
      name: "productCode",
      title: "\u4EA7\u54C1\u7F16\u7801"
    },
    {
      type: "string",
      name: "stageName",
      title: "\u5DE5\u6BB5\u540D\u79F0"
    },
    {
      type: "json",
      interface: "json",
      name: "candidateLines",
      title: "\u5019\u9009\u4EA7\u7EBF",
      description: '\u4EA7\u7EBFID\u6570\u7EC4\uFF0C\u4F8B\u5982 ["3F3", "3F4"]'
    },
    {
      type: "boolean",
      name: "isFixed",
      title: "\u662F\u5426\u552F\u4E00\u4EA7\u7EBF",
      defaultValue: false
    },
    {
      type: "string",
      name: "remarks",
      title: "\u5907\u6CE8"
    }
  ],
  indexes: [
    {
      type: "B-tree",
      fields: ["productCode", "stageName"]
    }
  ]
});
