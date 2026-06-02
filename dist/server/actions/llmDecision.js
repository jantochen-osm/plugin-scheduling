/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var llmDecision_exports = {};
__export(llmDecision_exports, {
  applyLlmOrdering: () => applyLlmOrdering,
  fetchLlmDecisions: () => fetchLlmDecisions
});
module.exports = __toCommonJS(llmDecision_exports);
var fs = __toESM(require("fs"));
var https = __toESM(require("https"));
var path = __toESM(require("path"));
var import_schedulingSkill = require("./scheduling/schedulingSkill");
function readSkillContent() {
  const candidates = [
    // 开发环境：源码目录（tsx/ts-node 模式下 __dirname 指向源码）
    path.join(__dirname, "scheduling", "scheduling-skill.md"),
    // 生产构建：dist 目录可能的位置
    path.join(__dirname, "..", "scheduling", "scheduling-skill.md"),
    // 自定义覆盖路径
    process.env.SCHEDULING_SKILL_PATH || ""
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return fs.readFileSync(p, "utf-8");
      }
    } catch {
    }
  }
  return import_schedulingSkill.DEFAULT_SKILL_MD;
}
function callOpenAI(apiKey, model, messages, timeoutMs = 3e4) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages,
      temperature: 0.1,
      // 低温度保证输出确定性
      response_format: { type: "json_object" },
      max_tokens: 2e3
    });
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error("OpenAI request timeout"));
    }, timeoutMs);
    const req = https.request(
      {
        hostname: "api.openai.com",
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Length": Buffer.byteLength(body)
        }
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          clearTimeout(timer);
          if (res.statusCode !== 200) {
            reject(new Error(`OpenAI API ${res.statusCode}: ${data.slice(0, 200)}`));
          } else {
            resolve(data);
          }
        });
      }
    );
    req.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    req.write(body);
    req.end();
  });
}
function normalizeDecision(d) {
  if (!d || typeof d.prodId !== "string" || typeof d.priority !== "number") return null;
  return {
    prodId: d.prodId,
    priority: d.priority,
    preferredLines: Array.isArray(d.preferredLines) ? d.preferredLines : [],
    headcountMultiplier: typeof d.headcountMultiplier === "number" ? d.headcountMultiplier : 1,
    allowOvertime: d.allowOvertime === true,
    skip: d.skip === true,
    skipReason: typeof d.skipReason === "string" ? d.skipReason : void 0
  };
}
async function fetchLlmDecisions(orders, lineMapping, today, apiKey, model, logger) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j;
  if (!apiKey || orders.length === 0) return null;
  try {
    const orderSummary = orders.map((o) => ({
      prodId: o.prodId,
      itemId: o.itemId,
      dlvDate: o.dlvDate,
      qtySched: o.qtySched,
      keyAccount: o.keyAccount || "",
      overdueDays: o.overdueDays ?? 0
    }));
    const userContent = JSON.stringify({ today, orders: orderSummary, lineMapping });
    const systemContent = readSkillContent();
    (_a = logger == null ? void 0 : logger.info) == null ? void 0 : _a.call(logger, `[LLM] Calling ${model} with ${orders.length} orders`);
    const t0 = Date.now();
    const raw = await callOpenAI(apiKey, model, [
      { role: "system", content: systemContent },
      { role: "user", content: userContent }
    ]);
    const elapsed = Date.now() - t0;
    const outer = JSON.parse(raw);
    const content = ((_d = (_c = (_b = outer == null ? void 0 : outer.choices) == null ? void 0 : _b[0]) == null ? void 0 : _c.message) == null ? void 0 : _d.content) || "";
    if (!content) {
      (_e = logger == null ? void 0 : logger.warn) == null ? void 0 : _e.call(logger, "[LLM] Empty content in response");
      return null;
    }
    const parsed = JSON.parse(content);
    (_f = logger == null ? void 0 : logger.info) == null ? void 0 : _f.call(logger, `[LLM] Done in ${elapsed}ms. Reasoning: ${parsed.reasoning || "(none)"}`);
    if (!Array.isArray(parsed.decisions)) {
      (_g = logger == null ? void 0 : logger.warn) == null ? void 0 : _g.call(logger, "[LLM] decisions is not an array");
      return null;
    }
    const decisions = [];
    for (const d of parsed.decisions) {
      const nd = normalizeDecision(d);
      if (!nd) {
        (_h = logger == null ? void 0 : logger.warn) == null ? void 0 : _h.call(logger, `[LLM] Invalid decision entry: ${JSON.stringify(d)}`);
        return null;
      }
      decisions.push(nd);
    }
    const coveredIds = new Set(decisions.map((d) => d.prodId));
    const missing = orders.filter((o) => !coveredIds.has(o.prodId));
    if (missing.length > 0) {
      (_i = logger == null ? void 0 : logger.warn) == null ? void 0 : _i.call(logger, `[LLM] Missing decisions for: ${missing.map((o) => o.prodId).join(", ")}`);
      return null;
    }
    return decisions;
  } catch (e) {
    (_j = logger == null ? void 0 : logger.warn) == null ? void 0 : _j.call(logger, `[LLM] fetchLlmDecisions failed: ${(e == null ? void 0 : e.message) || String(e)}`);
    return null;
  }
}
function applyLlmOrdering(orders, decisions) {
  const priorityMap = new Map(decisions.map((d) => [d.prodId, d.priority]));
  return [...orders].sort((a, b) => {
    const pa = priorityMap.get(a.prodId) ?? 9999;
    const pb = priorityMap.get(b.prodId) ?? 9999;
    return pa - pb;
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  applyLlmOrdering,
  fetchLlmDecisions
});
