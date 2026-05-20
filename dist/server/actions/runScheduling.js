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
  safetyBuffer: 2,
  // 安全缓冲天数
  leadTimeMultiplier: 1.5,
  // 前置工段系数
  maxLinesNormal: 3,
  // 正常最多使用产线数（保留 buffer）
  maxLinesOverflow: 4,
  // 溢出时最多线数（100% 产能，仅当 3 条线全满时）
  bufferRatio: 0.1,
  // 每日产能保留 buffer 比例（10%）
  headcountTolerance: 2,
  // headcount 差值 ≤ 2 视为相近，优先同线
  seriesPrefixLen: 6
  // itemId 前 N 位作为系列 key
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
      exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: "MISSING_DLV_DATE", severity: "BLOCKER", message: "DlvDate \u4E3A\u7A7A" });
      continue;
    }
    const dlvDate = new Date(mo.dlvDate);
    const today = /* @__PURE__ */ new Date();
    today.setHours(0, 0, 0, 0);
    if (dlvDate < today) {
      exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: "PAST_DLV_DATE", severity: "BLOCKER", message: `DlvDate=${mo.dlvDate} \u5DF2\u8FC7\u4EA4\u671F` });
      continue;
    }
    if (mo.qtySched <= 0) {
      exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: "INVALID_QTY", severity: "BLOCKER", message: `QtySched=${mo.qtySched}` });
      continue;
    }
    if (mo.osmCategory !== MVP_CONFIG.osmCategory) continue;
    if (!MVP_CONFIG.mvpPools.includes(mo.prodPoolId)) continue;
    valid.push(mo);
  }
  return { validOrders: valid, exceptions };
}
function getSeriesKey(itemId) {
  return (itemId || "").slice(0, MVP_CONFIG.seriesPrefixLen);
}
function step3_sort(orders) {
  return [...orders].sort((a, b) => {
    const aOverdue = a.overdueDays || 0;
    const bOverdue = b.overdueDays || 0;
    if (aOverdue !== bOverdue) return bOverdue - aOverdue;
    const aSeries = getSeriesKey(a.itemId);
    const bSeries = getSeriesKey(b.itemId);
    if (aSeries !== bSeries) return aSeries.localeCompare(bSeries);
    const aHc = a.headcount || 0;
    const bHc = b.headcount || 0;
    if (aHc !== bHc) return aHc - bHc;
    return new Date(a.dlvDate).getTime() - new Date(b.dlvDate).getTime();
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
function tryAllocateSingleLine(line, startFrom, qtySched, uph, pool, allowOverflow) {
  let remaining = qtySched;
  const dailyPlan = {};
  const consumed = [];
  let startDate = "";
  let finishDate = "";
  let curDate = startFrom;
  let dayCount = 0;
  const bufferFactor = allowOverflow ? 0 : MVP_CONFIG.bufferRatio;
  while (remaining > 0 && dayCount < MVP_CONFIG.maxDays) {
    const dateStr = curDate;
    const totalHours = pool.calendarMap.get(dateStr) || 0;
    const reservedHours = totalHours * bufferFactor;
    const remainingHours = pool.getRemaining(line, dateStr) - reservedHours;
    if (remainingHours < 0.1) {
      curDate = addDays(dateStr, 1);
      dayCount++;
      continue;
    }
    const maxQtyToday = remainingHours * uph;
    const qtyToday = remaining <= maxQtyToday ? remaining : Math.floor(maxQtyToday);
    if (qtyToday <= 0) {
      curDate = addDays(dateStr, 1);
      dayCount++;
      continue;
    }
    const hoursToday = qtyToday / uph;
    pool.consume(line, dateStr, hoursToday);
    consumed.push({ line, date: dateStr, hours: hoursToday });
    dailyPlan[dateStr] = (dailyPlan[dateStr] || 0) + qtyToday;
    remaining -= qtyToday;
    if (!startDate) startDate = dateStr;
    finishDate = dateStr;
    if (remaining > 0) {
      curDate = addDays(dateStr, 1);
      dayCount++;
    }
  }
  if (remaining > 0) {
    for (const c of consumed) pool.restore(c.line, c.date, c.hours);
    return null;
  }
  return { dailyPlan, consumed, startDate, finishDate };
}
function mergeTailFragment(line, dailyPlan, uph, pool) {
  const sortedDates = Object.keys(dailyPlan).sort();
  let finishDate = sortedDates[sortedDates.length - 1] || "";
  for (let i = sortedDates.length - 1; i >= 1; i--) {
    const curDay = sortedDates[i];
    const prevDay = sortedDates[i - 1];
    if (dailyPlan[curDay] < 10 && dailyPlan[curDay] < dailyPlan[prevDay]) {
      const frag = dailyPlan[curDay];
      const fragH = frag / uph;
      dailyPlan[prevDay] += frag;
      pool.restore(line, curDay, fragH);
      pool.consume(line, prevDay, fragH);
      delete dailyPlan[curDay];
      if (curDay === finishDate) finishDate = prevDay;
    }
  }
  return finishDate;
}
function scheduleAll(sortedOrders, routeMap, lineCodes, pool) {
  const results = [];
  const exceptions = [];
  const lineLoad = {};
  for (const l of lineCodes) lineLoad[l] = 0;
  const lineSeriesMap = {};
  const lineHeadcountMap = {};
  for (const l of lineCodes) {
    lineSeriesMap[l] = [];
    lineHeadcountMap[l] = [];
  }
  for (const mo of sortedOrders) {
    let rankLines = function(overflow) {
      return [...lineCodes].sort((a, b) => {
        const aHasSeries = lineSeriesMap[a].includes(seriesKey) ? 1 : 0;
        const bHasSeries = lineSeriesMap[b].includes(seriesKey) ? 1 : 0;
        if (aHasSeries !== bHasSeries) return bHasSeries - aHasSeries;
        const aHcList = lineHeadcountMap[a];
        const bHcList = lineHeadcountMap[b];
        const aAvgHc = aHcList.length ? aHcList.reduce((s, v) => s + v, 0) / aHcList.length : 999;
        const bAvgHc = bHcList.length ? bHcList.reduce((s, v) => s + v, 0) / bHcList.length : 999;
        const aDiff = Math.abs(aAvgHc - headcount);
        const bDiff = Math.abs(bAvgHc - headcount);
        const aHcScore = aDiff <= MVP_CONFIG.headcountTolerance ? 1 : 0;
        const bHcScore = bDiff <= MVP_CONFIG.headcountTolerance ? 1 : 0;
        if (aHcScore !== bHcScore) return bHcScore - aHcScore;
        const aIdx = MVP_CONFIG.targetLines.indexOf(a);
        const bIdx = MVP_CONFIG.targetLines.indexOf(b);
        return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
      });
    };
    const routeData = routeMap.get(mo.itemId);
    if (!routeData) {
      exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: "MISSING_ROUTE", severity: "BLOCKER", message: `\u65E0 Assembly \u8DEF\u7EBF` });
      continue;
    }
    const uph = routeData.uph;
    const headcount = routeData.headcount;
    const seriesKey = getSeriesKey(mo.itemId);
    const totalHours = mo.qtySched / uph;
    const today = formatDate(/* @__PURE__ */ new Date());
    const dlv = mo.dlvDate instanceof Date ? formatDate(mo.dlvDate) : mo.dlvDate;
    const assemblyDays = Math.ceil(totalHours / MVP_CONFIG.defaultWorkHours);
    const totalProdDays = Math.ceil(assemblyDays * MVP_CONFIG.leadTimeMultiplier);
    const latestStart = addDays(dlv, -(totalProdDays + MVP_CONFIG.safetyBuffer));
    const startFrom = latestStart > today ? latestStart : today;
    const expansionOrder = MVP_CONFIG.targetLines.filter((l) => lineCodes.includes(l));
    let scheduled = false;
    const maxLines = MVP_CONFIG.maxLinesOverflow;
    for (let lineCount = 1; lineCount <= maxLines && !scheduled; lineCount++) {
      const isOverflow = lineCount > MVP_CONFIG.maxLinesNormal;
      if (isOverflow) {
        const normalLines = rankLines(false).slice(0, MVP_CONFIG.maxLinesNormal);
        const totalNormalCap = normalLines.reduce((s, l) => s + pool.getTotalRemaining(l, startFrom), 0);
        if (totalNormalCap >= totalHours * 0.5) continue;
      }
      const candidateLines = lineCount === 1 ? rankLines(isOverflow).slice(0, 1) : expansionOrder.slice(0, lineCount);
      const qtyPerLine = Math.floor(mo.qtySched / lineCount);
      const remainder = mo.qtySched - qtyPerLine * lineCount;
      const lineResults = [];
      let allSuccess = true;
      for (let li = 0; li < candidateLines.length; li++) {
        const tryLine = candidateLines[li];
        const assignQty = li === 0 ? qtyPerLine + remainder : qtyPerLine;
        if (assignQty <= 0) {
          lineResults.push({ line: tryLine, dailyPlan: {}, startDate: "", finishDate: "" });
          continue;
        }
        const alloc = tryAllocateSingleLine(tryLine, startFrom, assignQty, uph, pool, isOverflow);
        if (!alloc) {
          allSuccess = false;
          break;
        }
        const fd = mergeTailFragment(tryLine, alloc.dailyPlan, uph, pool);
        lineResults.push({ line: tryLine, dailyPlan: alloc.dailyPlan, startDate: alloc.startDate, finishDate: fd });
      }
      if (!allSuccess) {
        for (const lr of lineResults) {
          for (const [date, qty] of Object.entries(lr.dailyPlan)) {
            pool.restore(lr.line, date, qty / uph);
          }
        }
        continue;
      }
      const latestFinish = lineResults.map((r) => r.finishDate).filter(Boolean).sort().pop() || "";
      if (latestFinish > dlv && lineCount < maxLines) {
        for (const lr of lineResults) {
          for (const [date, qty] of Object.entries(lr.dailyPlan)) {
            pool.restore(lr.line, date, qty / uph);
          }
        }
        continue;
      }
      scheduled = true;
      const allStartDates = lineResults.map((r) => r.startDate).filter(Boolean).sort();
      const allFinishDates = lineResults.map((r) => r.finishDate).filter(Boolean).sort();
      const startDate = allStartDates[0] || "";
      const finishDate = allFinishDates[allFinishDates.length - 1] || "";
      const chosenLine = lineResults.map((r) => r.line).join(",");
      const combinedDailyPlan = {};
      for (const lr of lineResults) {
        for (const [date, qty] of Object.entries(lr.dailyPlan)) {
          combinedDailyPlan[date] = (combinedDailyPlan[date] || 0) + qty;
        }
        lineLoad[lr.line] = (lineLoad[lr.line] || 0) + mo.qtySched / lineCount / uph;
        lineSeriesMap[lr.line].push(seriesKey);
        lineHeadcountMap[lr.line].push(headcount);
      }
      const dlvStr = dlv;
      const todayStr = today;
      const overdueDays = finishDate > dlvStr ? Math.ceil((new Date(finishDate).getTime() - new Date(dlvStr).getTime()) / 864e5) : 0;
      let overdueType = "ON_TIME";
      if (dlvStr < todayStr) overdueType = "PAST_DUE";
      else if (overdueDays > 0) overdueType = "AT_RISK";
      if (overdueType === "AT_RISK") {
        exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: "DELIVERY_AT_RISK", severity: "WARNING", message: `\u6392\u4EA7\u903E\u671F\uFF1A\u9884\u8BA1\u5B8C\u6210 ${finishDate}\uFF0C\u8D85\u4EA4\u671F ${overdueDays} \u5929` });
      } else if (overdueType === "PAST_DUE") {
        exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: "PAST_DUE_SCHEDULED", severity: "WARNING", message: `\u5DF2\u8FC7\u4EA4\u671F ${dlvStr}\uFF0C\u9884\u8BA1\u5B8C\u6210 ${finishDate}` });
      }
      results.push({
        prodId: mo.prodId,
        itemId: mo.itemId,
        totalQty: mo.qtySched,
        dlvDate: dlvStr,
        prodStatus: mo.prodStatus,
        prodPoolId: mo.prodPoolId,
        osmCategory: mo.osmCategory,
        startDate,
        finishDate,
        isOverdue: overdueDays > 0,
        overdueDays,
        overdueType,
        candidateLines: lineCodes.join(","),
        chosenLine,
        linesUsed: lineCount,
        isOverflow,
        uph,
        headcount,
        dailyPlan: Object.keys(combinedDailyPlan).length > 0 ? combinedDailyPlan : null
      });
    }
    if (!scheduled) {
      exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: "CALENDAR_EXHAUSTED", severity: "BLOCKER", message: `\u5C1D\u8BD5\u6700\u591A ${maxLines} \u6761\u7EBF\u4ECD\u65E0\u6CD5\u6392\u4EA7` });
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
    const orderCount = results.filter((r) => r.chosenLine?.includes(line)).length;
    return {
      line,
      totalCapacityHours: Math.round(totalCapacity * 10) / 10,
      usedHours: Math.round(usedHours * 10) / 10,
      utilizationRate: totalCapacity > 0 ? Math.round(usedHours / totalCapacity * 1e3) / 10 : 0,
      activeCapacityHours: Math.round(activeCapacity * 10) / 10,
      activeUsedHours: Math.round(activeUsed * 10) / 10,
      activeRate: activeCapacity > 0 ? Math.round(activeUsed / activeCapacity * 1e3) / 10 : 0,
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
  const allOrders = await step1_fetchOrders(ctx);
  ctx.logger?.info?.(`[Step 1] \u52A0\u8F7D ${allOrders.length} \u6761\u8BA2\u5355`);
  const { validOrders, exceptions: valEx } = step2_validate(allOrders);
  ctx.logger?.info?.(`[Step 2] \u6821\u9A8C\u540E ${validOrders.length} \u6761\u6709\u6548, ${valEx.length} \u6761\u5F02\u5E38`);
  const sortedOrders = step3_sort(validOrders);
  ctx.logger?.info?.(`[Step 3] \u6392\u5E8F\u5B8C\u6210`);
  const routeMap = await step4_fetchRoutes(ctx);
  ctx.logger?.info?.(`[Step 4] \u52A0\u8F7D ${routeMap.size} \u6761 Assembly \u8DEF\u7EBF`);
  const lineCodes = await step5_fetchLines(ctx);
  ctx.logger?.info?.(`[Step 5] \u53EF\u7528\u4EA7\u7EBF: ${lineCodes.join(", ")}`);
  const pool = await step6_buildHourPool(ctx, lineCodes);
  ctx.logger?.info?.(`[Step 6] \u65E5\u5386\u5929\u6570: ${pool.calendarMap.size}`);
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
  ctx.logger?.info?.(`[Step 6] \u5DF2\u6E05\u7A7A ${oldResults.length} \u6761\u65E7\u7ED3\u679C, ${oldExcs.length} \u6761\u65E7\u5F02\u5E38`);
  const { results, exceptions: schedEx, lineUtilization } = scheduleAll(sortedOrders, routeMap, lineCodes, pool);
  ctx.logger?.info?.(`[Step 7-9] \u6392\u4EA7\u5B8C\u6210: ${results.length} \u6761\u7ED3\u679C, ${schedEx.length} \u6761\u5F02\u5E38`);
  for (const lu of lineUtilization) {
    ctx.logger?.info?.(`  \u4EA7\u7EBF ${lu.line}: ${lu.utilizationRate}% \u5229\u7528\u7387, ${lu.orderCount} \u5355, ${lu.peakDayCount} \u5929\u6EE1\u8F7D`);
  }
  const allExceptions = [...valEx, ...schedEx];
  const now = /* @__PURE__ */ new Date();
  const pad = (n) => n.toString().padStart(2, "0");
  const runId = `RUN_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  for (const r of results) r.runId = runId;
  for (const e of allExceptions) e.runId = runId;
  if (results.length > 0) {
    await resultRepo.create({ values: results });
    ctx.logger?.info?.(`[Step 9] \u5199\u5165 ${results.length} \u6761\u6392\u4EA7\u7ED3\u679C`);
  }
  if (allExceptions.length > 0) {
    await excRepo.create({ values: allExceptions });
    ctx.logger?.info?.(`[Step 10] \u5199\u5165 ${allExceptions.length} \u6761\u5F02\u5E38`);
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
  ctx.logger?.info?.(`[Step 11] \u5199\u5165\u8FD0\u884C\u8BB0\u5F55: ${runId}, \u6210\u529F\u7387 ${successRate}%`);
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
