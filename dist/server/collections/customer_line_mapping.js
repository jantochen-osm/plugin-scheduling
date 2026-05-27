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
var customer_line_mapping_exports = {};
__export(customer_line_mapping_exports, {
  default: () => customer_line_mapping_default
});
module.exports = __toCommonJS(customer_line_mapping_exports);
var import_database = require("@nocobase/database");
var customer_line_mapping_default = (0, import_database.defineCollection)({
  name: "customer_line_mapping",
  title: "\u5BA2\u6237\u4EA7\u7EBF\u6620\u5C04",
  dumpRules: "required",
  shared: true,
  filterTargetKey: "id",
  fields: [
    {
      type: "string",
      name: "keyAccount",
      title: "\u5BA2\u6237\u540D\u79F0"
    },
    {
      type: "string",
      name: "osmCategory",
      title: "\u5206\u7C7B",
      defaultValue: "ESG"
    },
    {
      type: "json",
      interface: "json",
      name: "assignedLines",
      title: "\u5206\u914D\u4EA7\u7EBF",
      description: '\u4EA7\u7EBFID\u6570\u7EC4\uFF0C\u4F8B\u5982 ["ESG_LINE_1"]'
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
      fields: ["keyAccount"]
    }
  ]
});
