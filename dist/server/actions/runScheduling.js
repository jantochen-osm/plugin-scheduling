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
var runScheduling_exports = {};
__export(runScheduling_exports, {
  runScheduling: () => runScheduling
});
module.exports = __toCommonJS(runScheduling_exports);
const MVP_CONFIG = {
  osmCategory: "EE",
  mvpPools: ["SC_YBSC_F3", "SC_YBSC_HT", "SCD_HT_CC", "SCD_HT_F3"],
  targetLines: ["3F3", "3F4", "3F5", "3F6"],
  defaultWorkHours: 10,
  maxDays: 365,
  setupTimeHours: 1,
  // 换线/换型惩罚时间（小时）
  minTailQty: 10,
  // 尾差合并阈值
  clusterWindowDays: 3,
  // 同品聚类窗口
  jitBufferDays: 2,
  // 后拉式安全缓冲：目标完工日 = 交期前 N 天（防止产能争抢导致逾期）
  // 选线权重
  lineSelectWeights: { capacity: 0.3, setupAffinity: 0.5, loadBalance: 0.2 },
  // 成本模型（加班需要额外场地+治具，综合成本高于新开产线）
  costModel: {
    standardHourRate: 1,
    // 标准工时成本基线
    overtimeMultiplier: 2.5,
    // 加班成本倍率（场地+治具+加班费 = 2.5x）
    additionalLineMultiplier: 1.2
    // 新增产线成本倍率（已有场地和治具 = 1.2x）
  }
};
async function step1_fetchOrders(ctx) {
  const repo = ctx.db.getRepository("production_order_ds");
  const rows = await repo.find({ paginate: false });
  return rows.map((r) => ({
    prodId: r.prod_id,
    itemId: r.item_id,
    qtySched: Number(r.qty_sched) || 0,
    dlvDate: r.dlv_date,
    prodStatus: r.prod_status,
    prodPoolId: r.prod_pool_id,
    osmCategory: r.osm_category
  }));
}
function step2_validate(orders) {
  const valid = [];
  const exceptions = [];
  for (const mo of orders) {
    if (!mo.dlvDate) {
      exceptions.push({
        prodId: mo.prodId,
        itemId: mo.itemId,
        exceptionType: "MISSING_DLV_DATE",
        severity: "BLOCKER",
        message: "DlvDate \u4E3A\u7A7A"
      });
      continue;
    }
    const dlvDate = new Date(mo.dlvDate);
    const today = /* @__PURE__ */ new Date();
    today.setHours(0, 0, 0, 0);
    if (dlvDate < today) {
      exceptions.push({
        prodId: mo.prodId,
        itemId: mo.itemId,
        exceptionType: "PAST_DLV_DATE",
        severity: "BLOCKER",
        message: `DlvDate=${mo.dlvDate} \u5DF2\u8FC7\u4EA4\u671F`
      });
      continue;
    }
    if (mo.qtySched <= 0) {
      exceptions.push({
        prodId: mo.prodId,
        itemId: mo.itemId,
        exceptionType: "INVALID_QTY",
        severity: "BLOCKER",
        message: `QtySched=${mo.qtySched}`
      });
      continue;
    }
    if (mo.osmCategory !== MVP_CONFIG.osmCategory) continue;
    if (!MVP_CONFIG.mvpPools.includes(mo.prodPoolId)) continue;
    valid.push(mo);
  }
  return { validOrders: valid, exceptions };
}
function step3_sort(orders) {
  const windowDays = MVP_CONFIG.clusterWindowDays;
  const enriched = orders.map((o) => {
    const dlvTime = new Date(o.dlvDate).getTime();
    return { ...o, _dlvTime: dlvTime };
  });
  enriched.sort((a, b) => a._dlvTime - b._dlvTime);
  const baseTime = enriched.length > 0 ? enriched[0]._dlvTime : 0;
  const windowMs = windowDays * 864e5;
  for (const o of enriched) {
    o._windowIdx = Math.floor((o._dlvTime - baseTime) / windowMs);
  }
  return enriched.sort((a, b) => {
    const aOverdue = a.overdueDays || 0;
    const bOverdue = b.overdueDays || 0;
    if (aOverdue !== bOverdue) return bOverdue - aOverdue;
    if (a._windowIdx !== b._windowIdx) return a._windowIdx - b._windowIdx;
    if (a.itemId !== b.itemId) return a.itemId < b.itemId ? -1 : 1;
    return a._dlvTime - b._dlvTime;
  });
}
async function step4_fetchRoutes(ctx) {
  const repo = ctx.db.getRepository("route_operation");
  const rows = await repo.find({ paginate: false });
  const routeMap = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const itemId = r.fg_item_code;
    const opName = (r.operation_name || "").toLowerCase();
    const uph = Number(r.erp_uph) || 0;
    const headcount = Number(r.erp_plan_labor) || 0;
    if (opName.includes("assembly") && uph > 0) {
      routeMap.set(itemId, { uph, headcount });
    }
  }
  return routeMap;
}
async function step5_fetchLines(ctx) {
  const repo = ctx.db.getRepository("md_lines");
  const rows = await repo.find({ paginate: false });
  return rows.filter((l) => MVP_CONFIG.targetLines.includes(l.lineCode) && l.enabled).map((l) => l.lineCode);
}
function formatDate(d) {
  return d.toISOString().split("T")[0];
}
async function step6_buildHourPool(ctx, lineCodes) {
  const repo = ctx.db.getRepository("md_work_calendars");
  const rows = await repo.find({ paginate: false });
  const calendarMap = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const d = r.calendarDate ? formatDate(new Date(r.calendarDate)) : null;
    if (d && r.isSchedulable) {
      calendarMap.set(d, Number(r.workHours) || MVP_CONFIG.defaultWorkHours);
    }
  }
  const hourPool = /* @__PURE__ */ new Map();
  const initHourPool = () => {
    hourPool.clear();
    for (const [dateStr, hours] of calendarMap) {
      for (const line of lineCodes) {
        hourPool.set(`${line}_${dateStr}`, hours);
      }
    }
  };
  initHourPool();
  return {
    calendarMap,
    hourPool,
    // 获取某线某日剩余小时
    getRemaining(line, dateStr) {
      const key = `${line}_${dateStr}`;
      if (hourPool.has(key)) return hourPool.get(key);
      return calendarMap.get(dateStr) || 0;
    },
    // 扣减某线某日小时
    consume(line, dateStr, hours) {
      const key = `${line}_${dateStr}`;
      const cur = this.getRemaining(line, dateStr);
      hourPool.set(key, Math.max(0, cur - hours));
    },
    // 恢复某线某日小时（用于排产回滚）
    restore(line, dateStr, hours) {
      const key = `${line}_${dateStr}`;
      const cur = hourPool.get(key) || 0;
      hourPool.set(key, cur + hours);
    },
    // 获取某线从指定日期起的总剩余产能（用于选线决策）
    getTotalRemaining(line, fromDate) {
      let total = 0;
      for (const [dateStr] of calendarMap) {
        if (dateStr >= fromDate) {
          total += this.getRemaining(line, dateStr);
        }
      }
      return total;
    }
  };
}
function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return formatDate(d);
}
function calcLatestStart(pool, linesToTry, uph, totalQty, setupHours, dlvStr, today) {
  const hoursNeeded = totalQty / uph + setupHours;
  const schedulableDates = [];
  for (const [dateStr] of pool.calendarMap) {
    if (dateStr >= today && dateStr <= dlvStr) {
      schedulableDates.push(dateStr);
    }
  }
  schedulableDates.sort((a, b) => a > b ? -1 : a < b ? 1 : 0);
  let accumulatedHours = 0;
  let latestStart = today;
  for (const dateStr of schedulableDates) {
    for (const line of linesToTry) {
      accumulatedHours += pool.getRemaining(line, dateStr);
    }
    latestStart = dateStr;
    if (accumulatedHours >= hoursNeeded) {
      break;
    }
  }
  return latestStart;
}
function trySchedule(mo, linesToTry, pool, allowOvertime, uph, dlvStr, today, lineLastItem, startFrom) {
  let remainingQty = mo.qtySched;
  let curDate = startFrom || today;
  let dayCount = 0;
  const dailyPlans = {};
  const extraPlans = {};
  const consumed = [];
  const isFirstDayForLine = {};
  for (const l of linesToTry) {
    dailyPlans[l] = {};
    extraPlans[l] = {};
    isFirstDayForLine[l] = true;
  }
  while (remainingQty > 0 && dayCount < MVP_CONFIG.maxDays) {
    const dateStr = typeof curDate === "string" ? curDate : formatDate(new Date(curDate));
    let totalRemainingCapacity = 0;
    for (const [calDate] of pool.calendarMap) {
      if (calDate >= dateStr && calDate <= dlvStr) {
        for (const ln of linesToTry) {
          totalRemainingCapacity += pool.getRemaining(ln, calDate);
        }
      }
    }
    const hoursNeeded = remainingQty / uph;
    const isFallingBehind = hoursNeeded > totalRemainingCapacity;
    for (const line of linesToTry) {
      if (remainingQty <= 0) break;
      const remHours = pool.getRemaining(line, dateStr);
      let extraHours = 0;
      let setupHoursToConsume = 0;
      if (isFirstDayForLine[line] && lineLastItem[line] !== mo.itemId) {
        setupHoursToConsume = MVP_CONFIG.setupTimeHours;
      }
      if (allowOvertime && isFallingBehind) {
        extraHours = Math.min(MVP_CONFIG.defaultWorkHours, remainingQty / uph + setupHoursToConsume - remHours);
        if (extraHours < 0) extraHours = 0;
      }
      const totalAvailableHours = remHours + extraHours;
      if (totalAvailableHours <= setupHoursToConsume + 0.1) continue;
      const maxQty = (totalAvailableHours - setupHoursToConsume) * uph;
      const qtyToday = remainingQty <= maxQty ? remainingQty : Math.floor(maxQty);
      if (qtyToday <= 0) continue;
      const standardHoursForSetup = Math.min(setupHoursToConsume, remHours);
      const remainingRemHoursForProduction = Math.max(0, remHours - standardHoursForSetup);
      const qtyFromStandard = Math.min(qtyToday, remainingRemHoursForProduction * uph);
      const qtyFromExtra = Math.max(0, qtyToday - qtyFromStandard);
      const standardHoursToConsume = standardHoursForSetup + qtyFromStandard / uph;
      pool.consume(line, dateStr, standardHoursToConsume);
      consumed.push({ line, date: dateStr, hours: standardHoursToConsume });
      dailyPlans[line][dateStr] = qtyToday;
      if (qtyFromExtra > 0) extraPlans[line][dateStr] = qtyFromExtra;
      isFirstDayForLine[line] = false;
      remainingQty -= qtyToday;
    }
    if (remainingQty > 0) {
      curDate = addDays(dateStr, 1);
      dayCount++;
    }
  }
  for (const c of consumed) {
    pool.restore(c.line, c.date, c.hours);
  }
  let globalStart = "";
  let globalFinish = "";
  for (const line of linesToTry) {
    const dates = Object.keys(dailyPlans[line]).sort();
    if (dates.length > 0) {
      if (!globalStart || dates[0] < globalStart) globalStart = dates[0];
      if (!globalFinish || dates[dates.length - 1] > globalFinish) globalFinish = dates[dates.length - 1];
    }
  }
  const { standardHourRate, overtimeMultiplier, additionalLineMultiplier } = MVP_CONFIG.costModel;
  let totalStandardHours = 0;
  let totalOvertimeHours = 0;
  for (const line of linesToTry) {
    for (const dateStr of Object.keys(dailyPlans[line])) {
      const qty = dailyPlans[line][dateStr] || 0;
      const extraQty = extraPlans[line] && extraPlans[line][dateStr] || 0;
      const standardQty = Math.max(0, qty - extraQty);
      totalStandardHours += standardQty / uph;
      totalOvertimeHours += extraQty / uph;
    }
  }
  const baseLineCount = 1;
  const extraLines = Math.max(0, linesToTry.length - baseLineCount);
  const standardCost = totalStandardHours * standardHourRate;
  const overtimeCost = totalOvertimeHours * standardHourRate * overtimeMultiplier;
  const extraLineCost = extraLines > 0 ? (totalStandardHours + totalOvertimeHours) / linesToTry.length * extraLines * standardHourRate * additionalLineMultiplier : 0;
  const totalCost = standardCost + overtimeCost + extraLineCost;
  return {
    success: remainingQty <= 0,
    remaining: remainingQty,
    startDate: globalStart,
    finishDate: globalFinish,
    dailyPlans,
    extraPlans,
    linesUsed: linesToTry,
    // 成本估算
    costEstimate: {
      standardHours: Math.round(totalStandardHours * 10) / 10,
      overtimeHours: Math.round(totalOvertimeHours * 10) / 10,
      linesUsedCount: linesToTry.length,
      standardCost: Math.round(standardCost * 10) / 10,
      overtimeCost: Math.round(overtimeCost * 10) / 10,
      extraLineCost: Math.round(extraLineCost * 10) / 10,
      totalCost: Math.round(totalCost * 10) / 10
    }
  };
}
function getCombinations(arr, k) {
  if (k === 0) return [[]];
  if (k > arr.length) return [];
  const result = [];
  function dfs(start, current) {
    if (current.length === k) {
      result.push([...current]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      current.push(arr[i]);
      dfs(i + 1, current);
      current.pop();
    }
  }
  dfs(0, []);
  return result;
}
function scheduleAll(sortedOrders, routeMap, lineCodes, pool) {
  const results = [];
  const exceptions = [];
  const lineLoad = {};
  const lineLastItem = {};
  for (const l of lineCodes) {
    lineLoad[l] = 0;
    lineLastItem[l] = "";
  }
  for (const mo of sortedOrders) {
    const routeData = routeMap.get(mo.itemId);
    if (!routeData) {
      exceptions.push({
        prodId: mo.prodId,
        itemId: mo.itemId,
        exceptionType: "MISSING_ROUTE",
        severity: "BLOCKER",
        message: `\u65E0 Assembly \u8DEF\u7EBF`
      });
      continue;
    }
    const uph = routeData.uph;
    const headcount = routeData.headcount;
    const today = formatDate(/* @__PURE__ */ new Date());
    const dlvStr = mo.dlvDate instanceof Date ? formatDate(mo.dlvDate) : mo.dlvDate ? String(mo.dlvDate).split("T")[0] : "";
    const { capacity: w1, setupAffinity: w2, loadBalance: w3 } = MVP_CONFIG.lineSelectWeights;
    const maxLoad = Math.max(...lineCodes.map((l) => lineLoad[l]), 1);
    const lineCapacities = new Map(lineCodes.map((l) => [l, pool.getTotalRemaining(l, today)]));
    const maxCap = Math.max(...lineCapacities.values(), 1);
    const rankedLines = lineCodes.map((line) => {
      const capScore = lineCapacities.get(line) / maxCap;
      const affinityScore = lineLastItem[line] === mo.itemId ? 1 : 0;
      const loadScore = 1 - lineLoad[line] / maxLoad;
      const score = w1 * capScore + w2 * affinityScore + w3 * loadScore;
      return { line, score };
    }).sort((a, b) => b.score - a.score).map((x) => x.line);
    let bestResult = null;
    let foundIdeal = false;
    const maxLines = rankedLines.length;
    const bufferDlv = addDays(dlvStr, -MVP_CONFIG.jitBufferDays);
    const targetDlv = bufferDlv >= today ? bufferDlv : dlvStr;
    for (const allowOT of [false, true]) {
      for (let numLines = 1; numLines <= maxLines; numLines++) {
        const combos = numLines === 1 ? rankedLines.map((l) => [l]) : getCombinations(rankedLines, numLines);
        for (const linesToTry of combos) {
          const setupH = linesToTry.some((l) => lineLastItem[l] !== mo.itemId) ? MVP_CONFIG.setupTimeHours : 0;
          const startFrom = calcLatestStart(pool, linesToTry, uph, mo.qtySched, setupH, targetDlv, today);
          const res = trySchedule(mo, linesToTry, pool, allowOT, uph, dlvStr, today, lineLastItem, startFrom);
          if (res.success && res.finishDate <= dlvStr) {
            if (!bestResult || res.costEstimate.totalCost < bestResult.costEstimate.totalCost) {
              bestResult = res;
            }
            foundIdeal = true;
            break;
          }
          if (!bestResult || res.remaining < bestResult.remaining || res.remaining === 0 && res.finishDate < bestResult.finishDate) {
            bestResult = res;
          }
        }
        if (foundIdeal) break;
      }
      if (foundIdeal) break;
    }
    if (!foundIdeal && bestResult && bestResult.finishDate > dlvStr) {
      for (const allowOT of [false, true]) {
        for (let numLines = 1; numLines <= maxLines; numLines++) {
          const combos = numLines === 1 ? rankedLines.map((l) => [l]) : getCombinations(rankedLines, numLines);
          for (const linesToTry of combos) {
            const res = trySchedule(mo, linesToTry, pool, allowOT, uph, dlvStr, today, lineLastItem, today);
            if (res.success && res.finishDate <= dlvStr) {
              if (!bestResult || bestResult.finishDate > dlvStr || res.costEstimate.totalCost < bestResult.costEstimate.totalCost) {
                bestResult = res;
              }
              foundIdeal = true;
              break;
            }
            if (!bestResult || res.remaining < bestResult.remaining || res.remaining === 0 && res.finishDate < bestResult.finishDate) {
              bestResult = res;
            }
          }
          if (foundIdeal) break;
        }
        if (foundIdeal) break;
      }
    }
    if (bestResult) {
      if (bestResult.remaining > 0) {
        exceptions.push({
          prodId: mo.prodId,
          itemId: mo.itemId,
          exceptionType: "CALENDAR_EXHAUSTED",
          severity: "BLOCKER",
          message: `\u8D85\u51FA ${MVP_CONFIG.maxDays} \u5929\u4ECD\u6709 ${Math.round(
            bestResult.remaining
          )} \u672A\u6392\uFF08\u5DF2\u542F\u7528\u6700\u591A ${maxLines} \u6761\u7EBF\u5E76\u52A0\u53CC\u73ED\uFF09`
        });
      }
      for (const line of bestResult.linesUsed) {
        const dp = bestResult.dailyPlans[line];
        const ep = bestResult.extraPlans[line] || {};
        if (!dp || Object.keys(dp).length === 0) continue;
        const sortedDates = Object.keys(dp).sort();
        for (let i = sortedDates.length - 1; i >= 1; i--) {
          const curDay = sortedDates[i];
          const prevDay = sortedDates[i - 1];
          if (dp[curDay] < MVP_CONFIG.minTailQty && dp[curDay] < dp[prevDay]) {
            const fragment = dp[curDay];
            dp[prevDay] += fragment;
            delete dp[curDay];
            if (ep[curDay]) delete ep[curDay];
          }
        }
        let lineStartDate = "";
        let lineFinishDate = "";
        let lineTotalQty = 0;
        let lineSetupHours = 0;
        if (lineLastItem[line] !== mo.itemId) {
          lineSetupHours = MVP_CONFIG.setupTimeHours;
        }
        let isFirstDayToConsume = true;
        const finalDates = Object.keys(dp).sort();
        for (const dateStr of finalDates) {
          const qty = dp[dateStr];
          let setupH = 0;
          if (isFirstDayToConsume) {
            setupH = lineSetupHours;
          }
          isFirstDayToConsume = false;
          const extraQty = ep[dateStr] || 0;
          const standardQty = Math.max(0, qty - extraQty);
          const totalStandardHoursNeeded = setupH + standardQty / uph;
          const consumeH = Math.min(totalStandardHoursNeeded, pool.getRemaining(line, dateStr));
          pool.consume(line, dateStr, consumeH);
          lineTotalQty += qty;
          if (!lineStartDate || dateStr < lineStartDate) lineStartDate = dateStr;
          if (!lineFinishDate || dateStr > lineFinishDate) lineFinishDate = dateStr;
        }
        lineLastItem[line] = mo.itemId;
        lineLoad[line] += lineTotalQty / uph + lineSetupHours;
        const overdueDays = lineFinishDate > dlvStr ? Math.ceil((new Date(lineFinishDate).getTime() - new Date(dlvStr).getTime()) / 864e5) : 0;
        let overdueType = "ON_TIME";
        if (dlvStr < today) {
          overdueType = "PAST_DUE";
        } else if (overdueDays > 0) {
          overdueType = "AT_RISK";
        }
        if (overdueType === "AT_RISK") {
          exceptions.push({
            prodId: mo.prodId,
            itemId: mo.itemId,
            exceptionType: "DELIVERY_AT_RISK",
            severity: "WARNING",
            message: `\u4EA7\u7EBF ${line} \u9884\u8BA1\u5B8C\u6210 ${lineFinishDate}\uFF0C\u8D85\u4EA4\u671F ${overdueDays} \u5929`
          });
        } else if (overdueType === "PAST_DUE") {
          exceptions.push({
            prodId: mo.prodId,
            itemId: mo.itemId,
            exceptionType: "PAST_DUE_SCHEDULED",
            severity: "WARNING",
            message: `\u5DF2\u8FC7\u4EA4\u671F ${dlvStr}\uFF0C\u4EA7\u7EBF ${line} \u9884\u8BA1\u5B8C\u6210 ${lineFinishDate}`
          });
        }
        results.push({
          prodId: mo.prodId,
          itemId: mo.itemId,
          totalQty: lineTotalQty,
          dlvDate: dlvStr,
          prodStatus: mo.prodStatus,
          prodPoolId: mo.prodPoolId,
          osmCategory: mo.osmCategory,
          startDate: lineStartDate,
          finishDate: lineFinishDate,
          isOverdue: overdueDays > 0,
          overdueDays,
          overdueType,
          candidateLines: lineCodes.join(","),
          chosenLine: line,
          uph,
          headcount,
          dailyPlan: dp,
          extraCapacityPlan: Object.keys(ep).length > 0 ? ep : null,
          setupTimeUsed: lineSetupHours,
          // 成本估算（整单级别，每条线记录相同）
          costEstimate: bestResult.costEstimate
        });
      }
    }
  }
  const lineUtilization = lineCodes.map((line) => {
    let totalCapacity = 0;
    let usedHours = 0;
    let activeCapacity = 0;
    let activeUsed = 0;
    const peakDays = [];
    let firstActiveDay = "";
    let lastActiveDay = "";
    const today = formatDate(/* @__PURE__ */ new Date());
    for (const [dateStr, hours] of pool.calendarMap) {
      if (dateStr < today) continue;
      totalCapacity += hours;
      const remaining = pool.getRemaining(line, dateStr);
      const used = hours - remaining;
      usedHours += used;
      if (used > 0.1) {
        activeCapacity += hours;
        activeUsed += used;
        if (!firstActiveDay) firstActiveDay = dateStr;
        lastActiveDay = dateStr;
      }
      if (hours > 0 && used / hours > 0.95) peakDays.push(dateStr);
    }
    const orderCount = results.filter((r) => r.chosenLine === line).length;
    return {
      line,
      // 全日历利用率（从今天到年底）
      totalCapacityHours: Math.round(totalCapacity * 10) / 10,
      usedHours: Math.round(usedHours * 10) / 10,
      utilizationRate: totalCapacity > 0 ? Math.round(usedHours / totalCapacity * 1e3) / 10 : 0,
      // 活跃期利用率（仅有排产的天）— 体现实际繁忙程度
      activeCapacityHours: Math.round(activeCapacity * 10) / 10,
      activeUsedHours: Math.round(activeUsed * 10) / 10,
      activeRate: activeCapacity > 0 ? Math.round(activeUsed / activeCapacity * 1e3) / 10 : 0,
      // 排产窗口
      firstActiveDay,
      lastActiveDay,
      orderCount,
      peakDayCount: peakDays.length,
      peakDays: peakDays.slice(0, 10)
    };
  });
  return { results, exceptions, lineUtilization };
}
async function runScheduling(ctx) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x;
  const allOrders = await step1_fetchOrders(ctx);
  (_b = (_a = ctx.logger) == null ? void 0 : _a.info) == null ? void 0 : _b.call(_a, `[Step 1] \u52A0\u8F7D ${allOrders.length} \u6761\u8BA2\u5355`);
  const { validOrders, exceptions: valEx } = step2_validate(allOrders);
  (_d = (_c = ctx.logger) == null ? void 0 : _c.info) == null ? void 0 : _d.call(_c, `[Step 2] \u6821\u9A8C\u540E ${validOrders.length} \u6761\u6709\u6548, ${valEx.length} \u6761\u5F02\u5E38`);
  const sortedOrders = step3_sort(validOrders);
  (_f = (_e = ctx.logger) == null ? void 0 : _e.info) == null ? void 0 : _f.call(_e, `[Step 3] \u6392\u5E8F\u5B8C\u6210`);
  const routeMap = await step4_fetchRoutes(ctx);
  (_h = (_g = ctx.logger) == null ? void 0 : _g.info) == null ? void 0 : _h.call(_g, `[Step 4] \u52A0\u8F7D ${routeMap.size} \u6761 Assembly \u8DEF\u7EBF`);
  const lineCodes = await step5_fetchLines(ctx);
  (_j = (_i = ctx.logger) == null ? void 0 : _i.info) == null ? void 0 : _j.call(_i, `[Step 5] \u53EF\u7528\u4EA7\u7EBF: ${lineCodes.join(", ")}`);
  const pool = await step6_buildHourPool(ctx, lineCodes);
  (_l = (_k = ctx.logger) == null ? void 0 : _k.info) == null ? void 0 : _l.call(_k, `[Step 6] \u65E5\u5386\u5929\u6570: ${pool.calendarMap.size}`);
  const resultRepo = ctx.db.getRepository("schedule_results_v2");
  const excRepo = ctx.db.getRepository("schedule_exceptions_v2");
  const oldResults = await resultRepo.find({ fields: ["id"], paginate: false });
  if (oldResults.length > 0) {
    await resultRepo.destroy({ filterByTk: oldResults.map((r) => r.id) });
  }
  const oldExcs = await excRepo.find({ fields: ["id"], paginate: false });
  if (oldExcs.length > 0) {
    await excRepo.destroy({ filterByTk: oldExcs.map((r) => r.id) });
  }
  (_n = (_m = ctx.logger) == null ? void 0 : _m.info) == null ? void 0 : _n.call(_m, `[Step 6] \u5DF2\u6E05\u7A7A ${oldResults.length} \u6761\u65E7\u7ED3\u679C, ${oldExcs.length} \u6761\u65E7\u5F02\u5E38`);
  const { results, exceptions: schedEx, lineUtilization } = scheduleAll(sortedOrders, routeMap, lineCodes, pool);
  (_p = (_o = ctx.logger) == null ? void 0 : _o.info) == null ? void 0 : _p.call(_o, `[Step 7-9] \u6392\u4EA7\u5B8C\u6210: ${results.length} \u6761\u7ED3\u679C, ${schedEx.length} \u6761\u5F02\u5E38`);
  for (const lu of lineUtilization) {
    (_r = (_q = ctx.logger) == null ? void 0 : _q.info) == null ? void 0 : _r.call(
      _q,
      `  \u4EA7\u7EBF ${lu.line}: ${lu.utilizationRate}% \u5229\u7528\u7387, ${lu.orderCount} \u5355, ${lu.peakDayCount} \u5929\u6EE1\u8F7D`
    );
  }
  const allExceptions = [...valEx, ...schedEx];
  const now = /* @__PURE__ */ new Date();
  const pad = (n) => n.toString().padStart(2, "0");
  const runId = `RUN_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(
    now.getMinutes()
  )}${pad(now.getSeconds())}`;
  for (const r of results) r.runId = runId;
  for (const e of allExceptions) e.runId = runId;
  if (results.length > 0) {
    await resultRepo.create({ values: results });
    (_t = (_s = ctx.logger) == null ? void 0 : _s.info) == null ? void 0 : _t.call(_s, `[Step 9] \u5199\u5165 ${results.length} \u6761\u6392\u4EA7\u7ED3\u679C`);
  }
  if (allExceptions.length > 0) {
    await excRepo.create({ values: allExceptions });
    (_v = (_u = ctx.logger) == null ? void 0 : _u.info) == null ? void 0 : _v.call(_u, `[Step 10] \u5199\u5165 ${allExceptions.length} \u6761\u5F02\u5E38`);
  }
  const exceptionBreakdown = {};
  for (const e of allExceptions) {
    const t = e.exceptionType || "UNKNOWN";
    exceptionBreakdown[t] = (exceptionBreakdown[t] || 0) + 1;
  }
  const successRate = validOrders.length > 0 ? Math.round(results.length / validOrders.length * 1e3) / 10 : 0;
  const runRepo = ctx.db.getRepository("schedule_runs");
  await runRepo.create({
    values: {
      runId,
      runTime: now.toISOString(),
      status: "COMPLETED",
      totalOrders: allOrders.length,
      validOrders: validOrders.length,
      scheduledCount: results.length,
      exceptionCount: allExceptions.length,
      successRate,
      lineUtilization,
      exceptionBreakdown
    }
  });
  (_x = (_w = ctx.logger) == null ? void 0 : _w.info) == null ? void 0 : _x.call(_w, `[Step 11] \u5199\u5165\u8FD0\u884C\u8BB0\u5F55: ${runId}, \u6210\u529F\u7387 ${successRate}%`);
  ctx.body = {
    success: true,
    runId,
    totalOrders: allOrders.length,
    validOrders: validOrders.length,
    results: results.length,
    exceptions: allExceptions.length,
    successRate,
    lineUtilization
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runScheduling
});
