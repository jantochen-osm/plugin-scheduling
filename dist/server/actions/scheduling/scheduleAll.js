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
var scheduleAll_exports = {};
__export(scheduleAll_exports, {
  scheduleAll: () => scheduleAll
});
module.exports = __toCommonJS(scheduleAll_exports);
var import_engines = require("../../engines");
var import_config = require("./config");
var import_calcLatestStart = require("./calcLatestStart");
var import_tryScheduleStage = require("./tryScheduleStage");
function rankCandidateLines(allowedLines, lineCodes, lineLoad, lineLastItem, capacityPool, mo, uph, earliestStart, targetDlv, weights) {
  const maxLoad = Math.max(...lineCodes.map((l) => lineLoad[l] || 0), 1);
  const neededHours = uph > 0 ? mo.qtySched / uph : 1;
  return allowedLines.filter((l) => lineCodes.includes(l)).map((line) => {
    let windowCap = 0;
    for (let d = new Date(earliestStart), dEnd = new Date(targetDlv); d <= dEnd; d.setDate(d.getDate() + 1)) {
      windowCap += capacityPool.getAvailableHours(line, (0, import_config.formatDate)(d));
    }
    const capScore = Math.min(windowCap / neededHours, 1);
    const affinityScore = lineLastItem[line] === mo.itemId ? 1 : 0;
    const loadScore = 1 - (lineLoad[line] || 0) / maxLoad;
    const score = weights.capacity * capScore + weights.setupAffinity * affinityScore + weights.loadBalance * loadScore;
    return { line, score };
  }).sort((a, b) => b.score - a.score).map((x) => x.line);
}
function commitBestResult(mo, bestResult, allowedLines, stageName, routeUph, effectiveUph, headcount, actualHeadcount, dlvStr, today, lineLastItem, lineLoad, lineLastFinish, capacityPool, cfg) {
  const committed = [];
  for (const line of bestResult.linesUsed) {
    const dp = bestResult.dailyPlans[line] || {};
    const ep = bestResult.extraPlans[line] || {};
    const sortedDates = Object.keys(dp).sort();
    for (let i = sortedDates.length - 1; i >= 1; i--) {
      if (dp[sortedDates[i]] < import_config.SCHEDULING_CONFIG.minTailQty && dp[sortedDates[i]] < dp[sortedDates[i - 1]]) {
        dp[sortedDates[i - 1]] += dp[sortedDates[i]];
        delete dp[sortedDates[i]];
        if (ep[sortedDates[i]]) delete ep[sortedDates[i]];
      }
    }
    const lineSetupHours = lineLastItem[line] !== mo.itemId ? cfg.setupTimeHours : 0;
    let isFirstDay = true;
    let lineStart = "";
    let lineFinish = "";
    let lineQty = 0;
    const perPersonUph = headcount > 0 ? routeUph / headcount : 0;
    const detailMap = {};
    for (const dateStr of Object.keys(dp).sort()) {
      const qty = dp[dateStr];
      const setupH = isFirstDay ? lineSetupHours : 0;
      isFirstDay = false;
      const extraQty = ep[dateStr] || 0;
      const standardQty = Math.max(0, qty - extraQty);
      const totalH = setupH + standardQty / effectiveUph;
      capacityPool.allocate(line, dateStr, Math.min(totalH, capacityPool.getAvailableHours(line, dateStr) + (setupH || 0)));
      const dayInfo = capacityPool.getDayInfo(dateStr);
      detailMap[dateStr] = {
        totalQty: qty,
        standardQty,
        overtimeQty: extraQty,
        baseWorkHours: dayInfo.baseWorkHours,
        overtimeHours: effectiveUph > 0 ? Math.round(extraQty / effectiveUph * 100) / 100 : 0,
        setupHours: setupH,
        effectiveHours: effectiveUph > 0 ? Math.round((standardQty / effectiveUph + setupH) * 100) / 100 : 0,
        uph: routeUph,
        perPersonUph: Math.round(perPersonUph * 100) / 100,
        headcount,
        actualHeadcount,
        effectiveUph: Math.round(effectiveUph * 100) / 100,
        dayType: qty > 0 && extraQty > 0 ? "OVERTIME" : dayInfo.dayType,
        dayLabel: dayInfo.dayLabel
      };
      lineQty += qty;
      if (!lineStart || dateStr < lineStart) lineStart = dateStr;
      if (!lineFinish || dateStr > lineFinish) lineFinish = dateStr;
    }
    lineLastItem[line] = mo.itemId;
    lineLoad[line] = (lineLoad[line] || 0) + lineQty / effectiveUph + lineSetupHours;
    if (lineFinish && (!lineLastFinish[line] || lineFinish > lineLastFinish[line])) {
      lineLastFinish[line] = lineFinish;
    }
    if (lineQty <= 0 || !lineStart || !lineFinish || lineStart === "Invalid date") continue;
    const overdueDays = lineFinish > dlvStr ? Math.ceil((new Date(lineFinish).getTime() - new Date(dlvStr).getTime()) / 864e5) : 0;
    const overdueType = dlvStr < today ? "PAST_DUE" : overdueDays > 0 ? "AT_RISK" : "ON_TIME";
    committed.push({
      prodId: mo.prodId,
      itemId: mo.itemId,
      totalQty: lineQty,
      dlvDate: dlvStr,
      prodStatus: mo.prodStatus,
      prodPoolId: mo.prodPoolId,
      osmCategory: mo.osmCategory,
      startDate: lineStart,
      finishDate: lineFinish,
      isOverdue: overdueDays > 0,
      overdueDays,
      overdueType,
      candidateLines: allowedLines.join(","),
      chosenLine: line,
      uph: routeUph,
      // DB 存工艺路线标准值（不随人数变化）
      headcount,
      // DB 存标准基础人力（增加的人力只体现在 dailyPlan 数量上）
      dailyPlan: dp,
      dailyPlanDetail: detailMap,
      // 每日排产计算构成
      extraCapacityPlan: Object.keys(ep).length > 0 ? ep : null,
      setupTimeUsed: lineSetupHours,
      costEstimate: bestResult.costEstimate,
      stage: stageName
    });
  }
  return committed;
}
async function scheduleAll(sortedOrders, ruleEngine, lineCodes, capacityPool, ctx, strategy) {
  const results = [];
  const exceptions = [];
  const sdm = new import_engines.StageDependencyManager();
  const today = (0, import_config.getTodayStr)();
  const cfg = strategy.getConfig();
  const stageDefMap = /* @__PURE__ */ new Map();
  for (const o of sortedOrders) {
    for (const s of o._stages || []) {
      if (!stageDefMap.has(s.stageName)) {
        stageDefMap.set(s.stageName, s.stageSequence ?? 99);
      }
    }
  }
  sdm.registerStages(
    [...stageDefMap.entries()].map(([stageName, stageSequence]) => ({ stageName, stageSequence }))
  );
  const lineLoad = {};
  const lineLastItem = {};
  const lineLastFinish = {};
  const lineHistory = {};
  for (const l of lineCodes) {
    lineLoad[l] = 0;
    lineLastItem[l] = "";
    lineLastFinish[l] = "";
    lineHistory[l] = null;
  }
  const weights = cfg.lineSelectWeights;
  for (const mo of sortedOrders) {
    let productStages = mo._stages || [];
    if (productStages.length === 0) {
      exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: "NO_STAGE_MAPPING", severity: "BLOCKER", message: "No stage mapping" });
      continue;
    }
    const activeStages = strategy.getActiveStages();
    if (activeStages.length > 0) {
      productStages = productStages.filter((s) => activeStages.includes(s.stageName));
    }
    if (productStages.length === 0) continue;
    for (const stage of productStages) {
      const stageName = stage.stageName;
      let allowedLines;
      if (mo.keyAccount) {
        const mapping = await ruleEngine.getCustomerLines(mo.keyAccount);
        allowedLines = mapping && mapping.assignedLines.length > 0 ? mapping.assignedLines : strategy.getFallbackLines();
      } else {
        allowedLines = strategy.getFallbackLines();
      }
      if (strategy.name === "ESG") {
        const itemId = mo.itemId || "";
        if (/^(AMZ-55-|55-)/i.test(itemId)) {
          allowedLines = ["4F2"];
        }
      }
      if (allowedLines.length === 0) {
        exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: "NO_CANDIDATE_LINE", severity: "BLOCKER", message: `Stage ${stageName}: no candidate lines` });
        continue;
      }
      let uph = 0;
      let headcount = 1;
      try {
        const routeRepo = ctx.db.getRepository("dn_operrouteline");
        const routes = await routeRepo.find({ filter: { item: mo.itemId, status: 1 }, paginate: false });
        for (const r of routes) {
          if ((r.oper || "").toLowerCase().includes(stageName.toLowerCase()) && Number(r.erpupph) > 0) {
            headcount = Number(r.planninglabor) || 1;
            uph = Math.round(Number(r.erpupph) * headcount * 100) / 100;
            break;
          }
        }
      } catch {
      }
      if (uph <= 0) {
        exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: "NO_ROUTE", severity: "BLOCKER", message: `Stage ${stageName}: no route for ${mo.itemId}` });
        continue;
      }
      const dlvStr = mo.dlvDate instanceof Date ? (0, import_config.formatDate)(mo.dlvDate) : String(mo.dlvDate || "").split("T")[0];
      const prevCompletion = sdm.getPreviousStageCompletion(mo.prodId, stageName);
      const earliestStart = prevCompletion ? (0, import_config.addDays)(prevCompletion, 1) : today;
      const bufferDlv = (0, import_config.addDays)(dlvStr, -cfg.jitBufferDays);
      const targetDlv = bufferDlv >= today ? bufferDlv : dlvStr;
      const rankedLines = rankCandidateLines(
        allowedLines,
        lineCodes,
        lineLoad,
        lineLastItem,
        capacityPool,
        mo,
        uph,
        earliestStart,
        targetDlv,
        weights
      );
      if (rankedLines.length === 0) {
        exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: "NO_AVAILABLE_LINE", severity: "BLOCKER", message: `Stage ${stageName}: no available line` });
        continue;
      }
      let bestResult = null;
      const maxLines = rankedLines.length;
      const uphPerPerson = uph / headcount;
      const maxHc = Math.round(headcount * (cfg.maxHeadcountFactor ?? 4));
      for (let hc = headcount; hc <= maxHc; hc++) {
        if ((bestResult == null ? void 0 : bestResult.finishDate) <= dlvStr) break;
        const effectiveUph = Math.round(uphPerPerson * hc * 100) / 100;
        for (const allowOT of [false, true]) {
          if ((bestResult == null ? void 0 : bestResult.finishDate) <= dlvStr) break;
          const maxNumLines = hc > headcount ? 1 : maxLines;
          for (let numLines = 1; numLines <= maxNumLines; numLines++) {
            if ((bestResult == null ? void 0 : bestResult.finishDate) <= dlvStr) break;
            const combos = numLines === 1 ? rankedLines.slice(0, 1).map((l) => [l]) : (0, import_tryScheduleStage.getCombinations)(rankedLines.slice(0, Math.min(numLines, 4)), numLines);
            for (const linesToTry of combos) {
              const setupH = linesToTry.some((l) => lineLastItem[l] !== mo.itemId) ? cfg.setupTimeHours : 0;
              const primaryLine = linesToTry[0] || "";
              const lineFinishDate = lineLastFinish[primaryLine] || "";
              const lineEarliestDate = lineFinishDate ? capacityPool.getAvailableHours(primaryLine, lineFinishDate) > 0 ? lineFinishDate : (0, import_config.addDays)(lineFinishDate, 1) : today;
              const effectiveEarliestStart = lineEarliestDate > earliestStart ? lineEarliestDate : earliestStart;
              const startFrom = (0, import_calcLatestStart.calcLatestStart)(
                capacityPool,
                linesToTry,
                effectiveUph,
                mo.qtySched,
                setupH,
                targetDlv,
                effectiveEarliestStart,
                true
              );
              const res = (0, import_tryScheduleStage.tryScheduleStage)(
                mo,
                linesToTry,
                capacityPool,
                allowOT,
                effectiveUph,
                dlvStr,
                effectiveEarliestStart,
                lineLastItem,
                cfg.setupTimeHours,
                startFrom
              );
              if (res) {
                res._hc = hc;
                res._setupH = setupH;
                res._effectiveEarliestStart = effectiveEarliestStart;
              }
              if (res.success && res.finishDate <= dlvStr) {
                const betterOnTime = !bestResult || !bestResult.success || bestResult.finishDate > dlvStr || (cfg.preferEarlyFinish ? res.finishDate < bestResult.finishDate : res.costEstimate.totalCost < bestResult.costEstimate.totalCost);
                if (betterOnTime) bestResult = res;
              } else if (!bestResult || !bestResult.success || bestResult.finishDate > dlvStr) {
                if (!bestResult || res.remaining < (bestResult.remaining ?? Infinity)) {
                  bestResult = res;
                }
              }
            }
          }
        }
      }
      if ((!bestResult || bestResult.finishDate > dlvStr) && rankedLines.length > 0) {
        const primaryLine = rankedLines[0];
        const hist = lineHistory[primaryLine];
        const prevMaxHc = Math.round(((hist == null ? void 0 : hist.baseHeadcount) ?? 1) * (cfg.maxHeadcountFactor ?? 4));
        if (hist && hist.headcountUsed < prevMaxHc) {
          for (const [ln, dateHoursMap] of Object.entries(hist.allocatedPerLine)) {
            for (const [date, hrs] of Object.entries(dateHoursMap)) {
              capacityPool.release(ln, date, hrs);
            }
          }
          for (const [ln, delta] of Object.entries(hist.lineLoadDeltaPerLine)) {
            lineLoad[ln] = Math.max(0, (lineLoad[ln] || 0) - delta);
          }
          const savedLineLastFinish = lineLastFinish[primaryLine];
          lineLastFinish[primaryLine] = hist.lineFinishBefore[primaryLine] || "";
          const prevUphPerPerson = hist.uph / hist.baseHeadcount;
          let chosenBoostHc = hist.baseHeadcount + 1;
          let chosenBoostRes = null;
          for (let bHc = hist.baseHeadcount + 1; bHc <= prevMaxHc; bHc++) {
            const bUph = Math.round(prevUphPerPerson * bHc * 100) / 100;
            const bStartFrom = (0, import_calcLatestStart.calcLatestStart)(
              capacityPool,
              hist.linesToTry,
              bUph,
              hist.orderRef.qtySched,
              hist.setupH,
              hist.targetDlvOfOrder,
              hist.effectiveEarliestStart,
              true
            );
            const bRes = (0, import_tryScheduleStage.tryScheduleStage)(
              hist.orderRef,
              hist.linesToTry,
              capacityPool,
              false,
              bUph,
              hist.dlvStr,
              hist.effectiveEarliestStart,
              lineLastItem,
              cfg.setupTimeHours,
              bStartFrom
            );
            if (!bRes.success) continue;
            chosenBoostRes = bRes;
            chosenBoostHc = bHc;
            const tentativeStart = bRes.finishDate > earliestStart ? bRes.finishDate : earliestStart;
            const neededDays = Math.ceil(mo.qtySched / uph / 10);
            const estimatedFinish = (0, import_config.addDays)(tentativeStart, neededDays);
            if (estimatedFinish <= dlvStr) break;
          }
          if (chosenBoostRes && chosenBoostRes.success) {
            const boostUph = Math.round(prevUphPerPerson * chosenBoostHc * 100) / 100;
            const boostPreAvail = {};
            for (const ln of hist.linesToTry) {
              boostPreAvail[ln] = {};
              for (const date of Object.keys(chosenBoostRes.dailyPlans[ln] || {})) {
                boostPreAvail[ln][date] = capacityPool.getAvailableHours(ln, date);
              }
            }
            const boostLineLoadBefore = {};
            for (const ln of hist.linesToTry) boostLineLoadBefore[ln] = lineLoad[ln] || 0;
            const boostCommitted = commitBestResult(
              hist.orderRef,
              chosenBoostRes,
              hist.allowedLines,
              hist.stageName,
              hist.uph,
              // routeUph: 前序订单工艺路线标准值（存 DB）
              boostUph,
              // effectiveUph: 增人后实际有效座产能（算工时）
              hist.baseHeadcount,
              // DB 存标准基础人力（增人只体现在 dailyPlan 上）
              chosenBoostHc,
              // actualHeadcount: 增人后实际人数
              hist.dlvStr,
              today,
              lineLastItem,
              lineLoad,
              lineLastFinish,
              capacityPool,
              cfg
            );
            const boostFinish = boostCommitted.map((r) => r.finishDate).sort().pop() ?? "";
            if (boostFinish) lineLastFinish[primaryLine] = boostFinish;
            for (let i = 0; i < hist.resultCount; i++) {
              if (i < boostCommitted.length && hist.resultStartIdx + i < results.length) {
                results[hist.resultStartIdx + i] = boostCommitted[i];
              }
            }
            const newAllocatedPerLine = {};
            for (const [ln, preMap] of Object.entries(boostPreAvail)) {
              newAllocatedPerLine[ln] = {};
              for (const [date, pre] of Object.entries(preMap)) {
                const diff = pre - capacityPool.getAvailableHours(ln, date);
                if (diff > 1e-3) newAllocatedPerLine[ln][date] = diff;
              }
            }
            const newLoadDelta = {};
            for (const ln of hist.linesToTry) {
              newLoadDelta[ln] = Math.max(0, (lineLoad[ln] || 0) - (boostLineLoadBefore[ln] || 0));
            }
            lineHistory[primaryLine] = {
              ...hist,
              headcountUsed: chosenBoostHc,
              allocatedPerLine: newAllocatedPerLine,
              lineLoadDeltaPerLine: newLoadDelta
            };
            for (let hc = headcount; hc <= maxHc; hc++) {
              if ((bestResult == null ? void 0 : bestResult.finishDate) <= dlvStr) break;
              const effectiveUph = Math.round(uphPerPerson * hc * 100) / 100;
              for (const allowOT of [false, true]) {
                if ((bestResult == null ? void 0 : bestResult.finishDate) <= dlvStr) break;
                const lfDateR = lineLastFinish[primaryLine] || "";
                const leDateR = lfDateR ? capacityPool.getAvailableHours(primaryLine, lfDateR) > 0 ? lfDateR : (0, import_config.addDays)(lfDateR, 1) : today;
                const eesR = leDateR > earliestStart ? leDateR : earliestStart;
                const retrySetupH = lineLastItem[primaryLine] !== mo.itemId ? cfg.setupTimeHours : 0;
                const startFromR = (0, import_calcLatestStart.calcLatestStart)(
                  capacityPool,
                  [primaryLine],
                  effectiveUph,
                  mo.qtySched,
                  retrySetupH,
                  targetDlv,
                  eesR,
                  true
                );
                const retryRes = (0, import_tryScheduleStage.tryScheduleStage)(
                  mo,
                  [primaryLine],
                  capacityPool,
                  allowOT,
                  effectiveUph,
                  dlvStr,
                  eesR,
                  lineLastItem,
                  cfg.setupTimeHours,
                  startFromR
                );
                if (retryRes) {
                  retryRes._hc = hc;
                  retryRes._setupH = retrySetupH;
                  retryRes._effectiveEarliestStart = eesR;
                }
                if (retryRes.success && retryRes.finishDate <= dlvStr) {
                  const better = !bestResult || !bestResult.success || bestResult.finishDate > dlvStr || (cfg.preferEarlyFinish ? retryRes.finishDate < bestResult.finishDate : retryRes.costEstimate.totalCost < bestResult.costEstimate.totalCost);
                  if (better) bestResult = retryRes;
                } else if (!bestResult || !bestResult.success || bestResult.finishDate > dlvStr) {
                  if (!bestResult || retryRes.remaining < (bestResult.remaining ?? Infinity)) {
                    bestResult = retryRes;
                  }
                }
              }
            }
          } else {
            for (const [ln, dateHoursMap] of Object.entries(hist.allocatedPerLine)) {
              for (const [date, hrs] of Object.entries(dateHoursMap)) {
                capacityPool.allocate(ln, date, hrs);
              }
            }
            for (const [ln, delta] of Object.entries(hist.lineLoadDeltaPerLine)) {
              lineLoad[ln] = (lineLoad[ln] || 0) + delta;
            }
            lineLastFinish[primaryLine] = savedLineLastFinish || "";
          }
        }
      }
      if (!bestResult || bestResult.remaining > 0) {
        exceptions.push({
          prodId: mo.prodId,
          itemId: mo.itemId,
          exceptionType: (bestResult == null ? void 0 : bestResult.remaining) > 0 ? "CAPACITY_INSUFFICIENT" : "SCHEDULE_FAILED",
          severity: (bestResult == null ? void 0 : bestResult.remaining) > 0 ? "WARNING" : "BLOCKER",
          message: `Stage ${stageName}: ${(bestResult == null ? void 0 : bestResult.remaining) > 0 ? `remaining ${Math.round(bestResult.remaining)}` : "no feasible plan"}`
        });
        if (!bestResult) continue;
      }
      const primaryLineForHist = rankedLines[0] || "";
      const lineFinishBeforeCommit = { ...lineLastFinish };
      const lineLoadBeforeCommit = { ...lineLoad };
      const hcForCommit = bestResult._hc ?? headcount;
      const effectiveUphForCommit = Math.round(uphPerPerson * hcForCommit * 100) / 100;
      const preAvailForHist = {};
      for (const line of bestResult.linesUsed || [primaryLineForHist]) {
        preAvailForHist[line] = {};
        for (const date of Object.keys(bestResult.dailyPlans[line] || {})) {
          preAvailForHist[line][date] = capacityPool.getAvailableHours(line, date);
        }
      }
      const committed = commitBestResult(
        mo,
        bestResult,
        allowedLines,
        stageName,
        uph,
        // routeUph: 工艺路线标准值（存 DB）
        effectiveUphForCommit,
        // effectiveUph: 实际有效产能（算工时）
        headcount,
        // 始终使用基础人力（增加的人力只体现在 dailyPlan 数量上）
        hcForCommit,
        // actualHeadcount: 实际人数（用于 dailyPlanDetail）
        dlvStr,
        today,
        lineLastItem,
        lineLoad,
        lineLastFinish,
        capacityPool,
        cfg
      );
      results.push(...committed);
      const allocatedPerLine = {};
      for (const [line, preMap] of Object.entries(preAvailForHist)) {
        allocatedPerLine[line] = {};
        for (const [date, pre] of Object.entries(preMap)) {
          const diff = pre - capacityPool.getAvailableHours(line, date);
          if (diff > 1e-3) allocatedPerLine[line][date] = diff;
        }
      }
      const lineLoadDeltaPerLine = {};
      for (const line of Object.keys(preAvailForHist)) {
        lineLoadDeltaPerLine[line] = Math.max(0, (lineLoad[line] || 0) - (lineLoadBeforeCommit[line] || 0));
      }
      if (primaryLineForHist && committed.length > 0) {
        lineHistory[primaryLineForHist] = {
          orderRef: mo,
          stageName,
          linesToTry: bestResult.linesUsed || [primaryLineForHist],
          allowedLines,
          effectiveEarliestStart: bestResult._effectiveEarliestStart ?? today,
          targetDlvOfOrder: targetDlv,
          dlvStr,
          uph,
          baseHeadcount: headcount,
          headcountUsed: hcForCommit,
          // 本次实际使用的绝对人数
          setupH: bestResult._setupH ?? 0,
          allocatedPerLine,
          lineLoadDeltaPerLine,
          lineFinishBefore: lineFinishBeforeCommit,
          resultStartIdx: results.length - committed.length,
          resultCount: committed.length
        };
      }
      const stageFinish = committed.map((r) => r.finishDate).sort().pop();
      if (stageFinish) {
        sdm.recordStageCompletion(mo.prodId, stageName, stageFinish);
      }
    }
  }
  for (const r of results) {
    const dp = r.dailyPlan || {};
    const detail = r.dailyPlanDetail || {};
    const cleanPlan = {};
    const cleanDetail = {};
    for (const [d, qty] of Object.entries(dp)) {
      if (qty > 0) {
        cleanPlan[d] = qty;
        if (detail[d]) cleanDetail[d] = detail[d];
      }
    }
    r.dailyPlan = cleanPlan;
    r.dailyPlanDetail = cleanDetail;
  }
  const lineUtilization = lineCodes.map((line) => {
    const totalCap = capacityPool.getMaxLoad(line);
    const used = capacityPool.getTotalLoad(line);
    return {
      line,
      totalCapacityHours: Math.round(totalCap * 10) / 10,
      usedHours: Math.round(used * 10) / 10,
      utilizationRate: totalCap > 0 ? Math.round(used / totalCap * 1e3) / 10 : 0,
      orderCount: results.filter((r) => r.chosenLine === line).length
    };
  });
  return { results, exceptions, lineUtilization };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  scheduleAll
});
