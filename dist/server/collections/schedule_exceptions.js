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
var schedule_exceptions_exports = {};
__export(schedule_exceptions_exports, {
  default: () => schedule_exceptions_default
});
module.exports = __toCommonJS(schedule_exceptions_exports);
var import_database = require("@nocobase/database");
var schedule_exceptions_default = (0, import_database.defineCollection)({
  name: "schedule_exceptions",
  title: "\u6392\u4EA7\u5F02\u5E38",
  filterTargetKey: "id",
  fields: [
    {
      type: "string",
      name: "prodId",
      title: "\u751F\u4EA7\u5355\u53F7"
    },
    {
      type: "string",
      name: "itemId",
      title: "\u6210\u54C1\u7F16\u7801"
    },
    {
      type: "string",
      name: "exceptionType",
      title: "\u5F02\u5E38\u7C7B\u578B"
    },
    {
      type: "string",
      name: "severity",
      title: "\u4E25\u91CD\u7A0B\u5EA6"
    },
    {
      type: "text",
      name: "message",
      title: "\u5F02\u5E38\u63CF\u8FF0"
    }
  ]
});
