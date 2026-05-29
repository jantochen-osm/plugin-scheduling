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
var CapacityPool_exports = {};
__export(CapacityPool_exports, {
  CapacityPool: () => CapacityPool
});
module.exports = __toCommonJS(CapacityPool_exports);
const DAY_LABELS = {
  "0": "\u5468\u65E5",
  "1": "\u5468\u4E00",
  "2": "\u5468\u4E8C",
  "3": "\u5468\u4E09",
  "4": "\u5468\u56DB",
  "5": "\u5468\u4E94",
  "6": "\u5468\u516D"
};
class CapacityPool {
  ruleEngine;
  baseHoursPerDay;
  /** line_date → { available, used } */
  pool = /* @__PURE__ */ new Map();
  /** date → base work hours (from md_work_calendars, before exceptions) */
  workHoursByDate = /* @__PURE__ */ new Map();
  /** date → exception info（补零日查询用） */
  exceptionByDate = /* @__PURE__ */ new Map();
  /** date → work calendar day info（补零日查询用） */
  calDayByDate = /* @__PURE__ */ new Map();
  /** 已加载的日期范围 */
  dateRange = [];
  lineCodes = [];
  constructor(ruleEngine, baseHoursPerDay = 10) {
    this.ruleEngine = ruleEngine;
    this.baseHoursPerDay = baseHoursPerDay;
  }
  // ─── 初始化 ───
  /**
   * 初始化产能池：为每条线、每个日期计算可用工时。
   * 基础工时来自 md_work_calendars，异常（HOLIDAY/MAINTENANCE）覆盖。
   */
  async init(lineCodes, startDate, endDate) {
    this.lineCodes = [...lineCodes];
    this.pool.clear();
    this.exceptionByDate.clear();
    this.calDayByDate.clear();
    this.dateRange = this.generateDateRange(startDate, endDate);
    for (const date of this.dateRange) {
      const calDay = await this.ruleEngine.getWorkCalendarDay(date);
      let baseHours = (calDay == null ? void 0 : calDay.workHours) ?? this.baseHoursPerDay;
      if (calDay && !calDay.isSchedulable) {
        baseHours = 0;
      }
      this.workHoursByDate.set(date, baseHours);
      this.calDayByDate.set(date, {
        isWorkday: !!(calDay == null ? void 0 : calDay.isWorkday),
        isSchedulable: !!(calDay == null ? void 0 : calDay.isSchedulable),
        dayOfWeek: (calDay == null ? void 0 : calDay.dayOfWeek) ?? 0,
        workHours: (calDay == null ? void 0 : calDay.workHours) ?? this.baseHoursPerDay
      });
      const exception = await this.ruleEngine.getCalendarException(date);
      if (exception) {
        this.exceptionByDate.set(date, {
          type: exception.exceptionType,
          remarks: exception.remarks || ""
        });
      }
      for (const line of lineCodes) {
        const key = `${line}_${date}`;
        const { availableHours } = this.applyException(line, date, exception, baseHours);
        this.pool.set(key, { available: availableHours, used: 0 });
      }
    }
  }
  // ─── 公开方法 ───
  /** 获取某线某日剩余可用工时 */
  getAvailableHours(line, date) {
    const key = `${line}_${date}`;
    const entry = this.pool.get(key);
    if (!entry) return 0;
    return Math.max(0, entry.available - entry.used);
  }
  /** 分配产能（扣减工时），返回实际分配量 */
  allocate(line, date, hours) {
    const key = `${line}_${date}`;
    const entry = this.pool.get(key);
    if (!entry) return 0;
    const available = Math.max(0, entry.available - entry.used);
    const allocated = Math.min(hours, available);
    entry.used += allocated;
    return allocated;
  }
  /**
   * 退还产能（rollback 专用），保证 used 不低于 0。
   * 不要用 allocate(-hours) 退还，那样会导致 used 变负、产能虚增。
   */
  release(line, date, hours) {
    const key = `${line}_${date}`;
    const entry = this.pool.get(key);
    if (!entry) return;
    entry.used = Math.max(0, entry.used - hours);
  }
  /** 获取某线的总已用工时 */
  getTotalLoad(line) {
    let total = 0;
    for (const [key, entry] of this.pool) {
      if (key.startsWith(`${line}_`)) {
        total += entry.used;
      }
    }
    return total;
  }
  /** 获取某线的总最大可用工时（未扣减前） */
  getMaxLoad(line) {
    let total = 0;
    for (const [key, entry] of this.pool) {
      if (key.startsWith(`${line}_`)) {
        total += entry.available;
      }
    }
    return total;
  }
  /** 获取某线的负载率 (0~1) */
  getLoadRate(line) {
    const max = this.getMaxLoad(line);
    if (max === 0) return 0;
    return this.getTotalLoad(line) / max;
  }
  /** 重置所有已用量（保留可用量） */
  reset() {
    for (const entry of this.pool.values()) {
      entry.used = 0;
    }
  }
  /** 获取某日的基础工时（来自 md_work_calendars） */
  getWorkHoursForDate(date) {
    return this.workHoursByDate.get(date) ?? this.baseHoursPerDay;
  }
  /**
   * 获取某日期的完整信息（用于 dailyPlanDetail 构建）。
   * 产线无关，返回日历级信息；CHANGEOVER 场景由调用方额外标注。
   */
  getDayInfo(date) {
    const cal = this.calDayByDate.get(date);
    const dayOfWeek = (cal == null ? void 0 : cal.dayOfWeek) ?? 0;
    const isWorkday = (cal == null ? void 0 : cal.isWorkday) ?? true;
    const isSchedulable = (cal == null ? void 0 : cal.isSchedulable) ?? true;
    const baseWorkHours = this.workHoursByDate.get(date) ?? this.baseHoursPerDay;
    const exc = this.exceptionByDate.get(date);
    const availableHours = isSchedulable ? baseWorkHours : 0;
    let dayType;
    let dayLabel;
    const dowLabel = DAY_LABELS[String(dayOfWeek)] || "";
    if (exc) {
      dayType = exc.type;
      dayLabel = exc.remarks ? `${this.getExceptionLabel(exc.type)}\uFF08${exc.remarks}\uFF09` : this.getExceptionLabel(exc.type);
    } else if (!isSchedulable && !isWorkday) {
      dayType = "WEEKEND";
      dayLabel = dowLabel;
    } else if (!isSchedulable) {
      dayType = "IDLE";
      dayLabel = dowLabel;
    } else {
      dayType = "WORKDAY";
      dayLabel = dowLabel;
    }
    return {
      date,
      dayOfWeek,
      isWorkday,
      isSchedulable,
      baseWorkHours,
      availableHours,
      exceptionType: exc ? exc.type : null,
      exceptionRemarks: (exc == null ? void 0 : exc.remarks) || null,
      dayType,
      dayLabel
    };
  }
  /** 异常类型中文标签 */
  getExceptionLabel(type) {
    switch (type) {
      case "HOLIDAY":
        return "\u5047\u671F";
      case "MAINTENANCE":
        return "\u8BBE\u5907\u4FDD\u517B";
      case "CHANGEOVER":
        return "\u4EA7\u54C1\u6362\u7EBF";
      default:
        return type;
    }
  }
  /** 获取某线全部日期的快照 */
  getLineSnapshot(line) {
    const snapshots = [];
    for (const date of this.dateRange) {
      const key = `${line}_${date}`;
      const entry = this.pool.get(key);
      if (entry) {
        snapshots.push({
          line,
          date,
          baseHours: this.workHoursByDate.get(date) ?? this.baseHoursPerDay,
          exceptionType: null,
          availableHours: entry.available,
          usedHours: entry.used
        });
      }
    }
    return snapshots;
  }
  // ─── 内部方法 ───
  /**
   * 根据异常类型调整可用工时。
   * baseHours 来自 md_work_calendars，异常在此基础上覆盖。
   * 异常优先级：HOLIDAY > MAINTENANCE > CHANGEOVER
   */
  applyException(line, date, exception, baseHours) {
    if (!exception) {
      return { availableHours: baseHours, exceptionType: null };
    }
    const affectsLine = exception.affectedLines === null || exception.affectedLines.includes(line);
    if (!affectsLine) {
      return { availableHours: baseHours, exceptionType: null };
    }
    switch (exception.exceptionType) {
      case "HOLIDAY":
        return { availableHours: exception.workHours, exceptionType: "HOLIDAY" };
      case "MAINTENANCE":
        return {
          availableHours: Math.min(exception.workHours, baseHours),
          exceptionType: "MAINTENANCE"
        };
      case "CHANGEOVER":
        return { availableHours: baseHours, exceptionType: "CHANGEOVER" };
      default:
        return { availableHours: baseHours, exceptionType: null };
    }
  }
  /** 生成日期范围（含起止） */
  generateDateRange(start, end) {
    const dates = [];
    const cur = new Date(start);
    const endDate = new Date(end);
    while (cur <= endDate) {
      dates.push(cur.toISOString().split("T")[0]);
      cur.setDate(cur.getDate() + 1);
    }
    return dates;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CapacityPool
});
