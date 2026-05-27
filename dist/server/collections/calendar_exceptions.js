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
var calendar_exceptions_exports = {};
__export(calendar_exceptions_exports, {
  default: () => calendar_exceptions_default
});
module.exports = __toCommonJS(calendar_exceptions_exports);
var import_database = require("@nocobase/database");
var calendar_exceptions_default = (0, import_database.defineCollection)({
  name: "calendar_exceptions",
  title: "\u65E5\u5386\u5F02\u5E38",
  dumpRules: "required",
  shared: true,
  filterTargetKey: "id",
  fields: [
    {
      type: "date",
      name: "exceptionDate",
      title: "\u5F02\u5E38\u65E5\u671F"
    },
    {
      type: "string",
      name: "exceptionType",
      title: "\u5F02\u5E38\u7C7B\u578B"
      // HOLIDAY, MAINTENANCE, CHANGEOVER
    },
    {
      type: "json",
      interface: "json",
      name: "affectedLines",
      title: "\u5F71\u54CD\u4EA7\u7EBF",
      description: "\u4E3A null \u8868\u793A\u5168\u7EBF\uFF0C\u5426\u5219\u4E3A\u4EA7\u7EBF\u6570\u7EC4"
    },
    {
      type: "float",
      name: "workHours",
      title: "\u5DE5\u4F5C\u65F6\u6570",
      description: "0 = \u505C\u5DE5\uFF0C\u5176\u4ED6\u6570\u503C\u4E3A\u90E8\u5206\u505C\u5DE5"
    },
    {
      type: "integer",
      name: "setupTime",
      title: "\u6362\u7EBF\u8017\u65F6",
      description: "\u5355\u4F4D\uFF1A\u5206\u949F"
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
      fields: ["exceptionDate"]
    }
  ]
});
