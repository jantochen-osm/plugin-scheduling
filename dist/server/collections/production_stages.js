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
var production_stages_exports = {};
__export(production_stages_exports, {
  default: () => production_stages_default
});
module.exports = __toCommonJS(production_stages_exports);
var import_database = require("@nocobase/database");
var production_stages_default = (0, import_database.defineCollection)({
  name: "production_stages",
  title: "\u751F\u4EA7\u5DE5\u6BB5",
  dumpRules: "required",
  shared: true,
  filterTargetKey: "id",
  fields: [
    {
      type: "string",
      name: "stageId",
      title: "\u5DE5\u6BB5ID"
    },
    {
      type: "string",
      name: "stageName",
      title: "\u5DE5\u6BB5\u540D\u79F0"
    },
    {
      type: "integer",
      name: "stageSequence",
      title: "\u5DE5\u6BB5\u987A\u5E8F"
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
      fields: ["stageName"]
    }
  ]
});
