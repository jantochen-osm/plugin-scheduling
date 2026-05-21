import { Context } from '@nocobase/server';

// ============================================================
// MVP 硬编码配置
// ============================================================
const MVP_CONFIG = {
  osmCategory: 'EE',
  mvpPools: ['SC_YBSC_F3', 'SC_YBSC_HT', 'SCD_HT_CC', 'SCD_HT_F3'],
  targetLines: ['3F3', '3F4', '3F5', '3F6'],
  defaultWorkHours: 10,
  maxDays: 365,
  setupTimeHours: 1, // 新增：换线/换型惩罚时间（小时）
  minTailQty: 10,    // 新增：尾差合并阈值
  clusterWindowDays: 3, // 同品聚类窗口：交期 ±N 天内的同物料订单连排
  // 选线权重（复合评分 = w1*产能 + w2*换型亲和 + w3*负载均衡）
  lineSelectWeights: { capacity: 0.3, setupAffinity: 0.5, loadBalance: 0.2 },
};

// ============================================================
// 步骤 1：筛选 EE 候选订单
// ============================================================
async function step1_fetchOrders(ctx: Context) {
  const repo = ctx.db.getRepository('production_order_ds');
  const rows = await repo.find({ paginate: false });
  return rows.map((r: any) => ({
    prodId: r.prod_id,
    itemId: r.item_id,
    qtySched: Number(r.qty_sched) || 0,
    dlvDate: r.dlv_date,
    prodStatus: r.prod_status,
    prodPoolId: r.prod_pool_id,
    osmCategory: r.osm_category,
  }));
}

// ============================================================
// 步骤 2：校验 Qty、DlvDate、FG Item Code
//   返回 { validOrders, exceptions }
// ============================================================
function step2_validate(orders: any[]) {
  const valid: any[] = [];
  const exceptions: any[] = [];

  for (const mo of orders) {
    // BLOCKER: 交期为空
    if (!mo.dlvDate) {
      exceptions.push({
        prodId: mo.prodId,
        itemId: mo.itemId,
        exceptionType: 'MISSING_DLV_DATE',
        severity: 'BLOCKER',
        message: 'DlvDate 为空',
      });
      continue;
    }
    // BLOCKER: 交期已过（小于当天）
    const dlvDate = new Date(mo.dlvDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (dlvDate < today) {
      exceptions.push({
        prodId: mo.prodId,
        itemId: mo.itemId,
        exceptionType: 'PAST_DLV_DATE',
        severity: 'BLOCKER',
        message: `DlvDate=${mo.dlvDate} 已过交期`,
      });
      continue;
    }
    // BLOCKER: 数量无效
    if (mo.qtySched <= 0) {
      exceptions.push({
        prodId: mo.prodId,
        itemId: mo.itemId,
        exceptionType: 'INVALID_QTY',
        severity: 'BLOCKER',
        message: `QtySched=${mo.qtySched}`,
      });
      continue;
    }
    // INFO: 非 EE 跳过
    if (mo.osmCategory !== MVP_CONFIG.osmCategory) continue;
    // INFO: 非目标订单池跳过
    if (!MVP_CONFIG.mvpPools.includes(mo.prodPoolId)) continue;

    valid.push(mo);
  }

  return { validOrders: valid, exceptions };
}

// ============================================================
// 步骤 3：多维优先级排序 + 同品聚类
//   优先级 1: 已逾期订单最优先（逾期天数越多越紧急）
//   优先级 2: 交期窗口分组（每 N 天一组）
//   优先级 3: 同一窗口内按 itemId 聚类（减少换型）
//   优先级 4: 同品内按 EDD 排序
// ============================================================
function step3_sort(orders: any[]) {
  const windowDays = MVP_CONFIG.clusterWindowDays;

  // 计算每个订单的交期时间戳和窗口编号
  const enriched = orders.map((o) => {
    const dlvTime = new Date(o.dlvDate).getTime();
    return { ...o, _dlvTime: dlvTime };
  });

  // 先按 EDD 排序取最早交期作为窗口基准
  enriched.sort((a, b) => a._dlvTime - b._dlvTime);
  const baseTime = enriched.length > 0 ? enriched[0]._dlvTime : 0;
  const windowMs = windowDays * 86400000;

  for (const o of enriched) {
    // 窗口编号：以最早交期为基准，每 windowDays 天一组
    o._windowIdx = Math.floor((o._dlvTime - baseTime) / windowMs);
  }

  // 最终排序：逾期优先 → 窗口编号 → 同品聚类 → EDD
  return enriched.sort((a, b) => {
    // 优先级 1: 逾期天数多的排前面
    const aOverdue = a.overdueDays || 0;
    const bOverdue = b.overdueDays || 0;
    if (aOverdue !== bOverdue) return bOverdue - aOverdue;

    // 优先级 2: 交期窗口分组
    if (a._windowIdx !== b._windowIdx) return a._windowIdx - b._windowIdx;

    // 优先级 3: 同一窗口内按 itemId 聚类（字典序，使同品订单相邻）
    if (a.itemId !== b.itemId) return a.itemId < b.itemId ? -1 : 1;

    // 优先级 4: 同品内按 EDD 排序
    return a._dlvTime - b._dlvTime;
  });
}

// ============================================================
// 步骤 4：查询工艺路线，只取 Assembly
//   返回 Map<itemId, uph>
// ============================================================
async function step4_fetchRoutes(ctx: Context) {
  const repo = ctx.db.getRepository('route_operation');
  const rows = await repo.find({ paginate: false });
  const routeMap = new Map<string, { uph: number; headcount: number }>();

  for (const r of rows as any[]) {
    const itemId = r.fg_item_code;
    const opName = (r.operation_name || '').toLowerCase();
    const uph = Number(r.erp_uph) || 0;
    const headcount = Number(r.erp_plan_labor) || 0;

    if (opName.includes('assembly') && uph > 0) {
      routeMap.set(itemId, { uph, headcount });
    }
  }

  return routeMap;
}

// ============================================================
// 步骤 5：加载产线，匹配 3F3~3F6
//   返回 string[] 可排产线代码
// ============================================================
async function step5_fetchLines(ctx: Context) {
  const repo = ctx.db.getRepository('md_lines');
  const rows = await repo.find({ paginate: false });
  return (rows as any[])
    .filter((l: any) => MVP_CONFIG.targetLines.includes(l.lineCode) && l.enabled)
    .map((l: any) => l.lineCode);
}

// ============================================================
// 步骤 6：加载日历，初始化 HourPool（逐线独立管理）
// ============================================================
function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

async function step6_buildHourPool(ctx: Context, lineCodes: string[]) {
  const repo = ctx.db.getRepository('md_work_calendars');
  const rows = await repo.find({ paginate: false });

  // calendarMap: dateStr -> availableHours
  const calendarMap = new Map<string, number>();
  for (const r of rows as any[]) {
    const d = r.calendarDate ? formatDate(new Date(r.calendarDate)) : null;
    if (d && r.isSchedulable) {
      calendarMap.set(d, Number(r.workHours) || MVP_CONFIG.defaultWorkHours);
    }
  }

  // hourPool: "lineCode_dateStr" -> remainingHours
  const hourPool = new Map<string, number>();
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
    getRemaining(line: string, dateStr: string) {
      const key = `${line}_${dateStr}`;
      if (hourPool.has(key)) return hourPool.get(key)!;
      return calendarMap.get(dateStr) || 0;
    },
    // 扣减某线某日小时
    consume(line: string, dateStr: string, hours: number) {
      const key = `${line}_${dateStr}`;
      const cur = this.getRemaining(line, dateStr);
      hourPool.set(key, Math.max(0, cur - hours));
    },
    // 恢复某线某日小时（用于排产回滚）
    restore(line: string, dateStr: string, hours: number) {
      const key = `${line}_${dateStr}`;
      const cur = hourPool.get(key) || 0;
      hourPool.set(key, cur + hours);
    },
    // 获取某线从指定日期起的总剩余产能（用于选线决策）
    getTotalRemaining(line: string, fromDate: string) {
      let total = 0;
      for (const [dateStr] of calendarMap) {
        if (dateStr >= fromDate) {
          total += this.getRemaining(line, dateStr);
        }
      }
      return total;
    },
  };
}

// ============================================================
// 步骤 7-9：逐单排产 + 输出结果
// ============================================================
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return formatDate(d);
}

// ============================================================
// 后拉式排产：从交期倒推最晚开工日
//   从 dlvDate 往前遍历日历，累加可用工时，
//   直到足够生产 totalQty，返回该日期。
//   如果倒推到 today 之前仍不够，返回 today（退化为前推式）。
// ============================================================
function calcLatestStart(
  pool: any,
  linesToTry: string[],
  uph: number,
  totalQty: number,
  setupHours: number,
  dlvStr: string,
  today: string,
): string {
  const hoursNeeded = totalQty / uph + setupHours;

  // 收集从 today 到 dlvStr 之间所有可排产日期，倒序排列
  const schedulableDates: string[] = [];
  for (const [dateStr] of pool.calendarMap) {
    if (dateStr >= today && dateStr <= dlvStr) {
      schedulableDates.push(dateStr);
    }
  }
  schedulableDates.sort((a, b) => (a > b ? -1 : a < b ? 1 : 0)); // 倒序

  let accumulatedHours = 0;
  let latestStart = today; // 兜底：如果产能不够就从今天开始

  for (const dateStr of schedulableDates) {
    // 累加该天所有候选线的可用工时
    for (const line of linesToTry) {
      accumulatedHours += pool.getRemaining(line, dateStr);
    }
    latestStart = dateStr;
    if (accumulatedHours >= hoursNeeded) {
      break; // 找到最晚开工日
    }
  }

  return latestStart;
}

function trySchedule(
  mo: any,
  linesToTry: string[],
  pool: any,
  allowOvertime: boolean,
  uph: number,
  dlvStr: string,
  today: string,
  lineLastItem: Record<string, string>,
  startFrom?: string, // 后拉式排产：指定开始日期（不传则从 today 开始）
) {
  let remainingQty = mo.qtySched;
  let curDate = startFrom || today;
  let dayCount = 0;

  const dailyPlans: Record<string, Record<string, number>> = {};
  const extraPlans: Record<string, Record<string, number>> = {};
  const consumed: { line: string; date: string; hours: number }[] = [];
  const isFirstDayForLine: Record<string, boolean> = {};

  for (const l of linesToTry) {
    dailyPlans[l] = {};
    extraPlans[l] = {};
    isFirstDayForLine[l] = true;
  }

  while (remainingQty > 0 && dayCount < MVP_CONFIG.maxDays) {
    const dateStr = typeof curDate === 'string' ? curDate : formatDate(new Date(curDate));

    // 精确累加日历剩余工时，判断是否需要加班
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

      // 如果是该订单在该线的第一天，且与上一单物料不同，产生换型惩罚时间
      let setupHoursToConsume = 0;
      if (isFirstDayForLine[line] && lineLastItem[line] !== mo.itemId) {
        setupHoursToConsume = MVP_CONFIG.setupTimeHours;
      }

      if (allowOvertime && isFallingBehind) {
        // 加班时间最多等于标准工时，且只补充生产和换型所需的差额
        extraHours = Math.min(MVP_CONFIG.defaultWorkHours, (remainingQty / uph) + setupHoursToConsume - remHours);
        if (extraHours < 0) extraHours = 0;
      }

      const totalAvailableHours = remHours + extraHours;
      
      // 时间不足以完成换型
      if (totalAvailableHours <= setupHoursToConsume + 0.1) continue;

      // 扣除换型时间后，才是真正能用来生产的最大数量
      const maxQty = (totalAvailableHours - setupHoursToConsume) * uph;
      const qtyToday = remainingQty <= maxQty ? remainingQty : Math.floor(maxQty);

      if (qtyToday <= 0) continue;

      // 计算标准工时消耗和加班工时对应的数量
      const standardHoursForSetup = Math.min(setupHoursToConsume, remHours);
      const remainingRemHoursForProduction = Math.max(0, remHours - standardHoursForSetup);

      const qtyFromStandard = Math.min(qtyToday, remainingRemHoursForProduction * uph);
      const qtyFromExtra = Math.max(0, qtyToday - qtyFromStandard);

      // 这部分工时直接占用系统的“剩余标准工时”
      const standardHoursToConsume = standardHoursForSetup + (qtyFromStandard / uph);

      // 仅虚拟扣减，用于后续回滚
      pool.consume(line, dateStr, standardHoursToConsume);
      consumed.push({ line, date: dateStr, hours: standardHoursToConsume });

      dailyPlans[line][dateStr] = qtyToday;
      if (qtyFromExtra > 0) extraPlans[line][dateStr] = qtyFromExtra;

      isFirstDayForLine[line] = false; // 换型惩罚仅扣减一次
      remainingQty -= qtyToday;
    }

    if (remainingQty > 0) {
      curDate = addDays(dateStr, 1);
      dayCount++;
    }
  }

  // 回滚本次尝试所有的产能扣减
  for (const c of consumed) {
    pool.restore(c.line, c.date, c.hours);
  }

  let globalStart = '';
  let globalFinish = '';
  for (const line of linesToTry) {
    const dates = Object.keys(dailyPlans[line]).sort();
    if (dates.length > 0) {
      if (!globalStart || dates[0] < globalStart) globalStart = dates[0];
      if (!globalFinish || dates[dates.length - 1] > globalFinish) globalFinish = dates[dates.length - 1];
    }
  }

  return {
    success: remainingQty <= 0,
    remaining: remainingQty,
    startDate: globalStart,
    finishDate: globalFinish,
    dailyPlans,
    extraPlans,
    linesUsed: linesToTry,
  };
}

// ============================================================
// 工具：组合枚举 C(arr, k)
//   4 条线时最多 C(4,2)=6 种组合，性能无影响
// ============================================================
function getCombinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > arr.length) return [];
  const result: T[][] = [];
  function dfs(start: number, current: T[]) {
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

function scheduleAll(
  sortedOrders: any[],
  routeMap: Map<string, { uph: number; headcount: number }>,
  lineCodes: string[],
  pool: any,
) {
  const results: any[] = [];
  const exceptions: any[] = [];
  
  // 产线负载追踪（用于负载均衡）
  const lineLoad: Record<string, number> = {};
  // 记录各产线最后生产的物料，用于计算换线时间 (Setup Time)
  const lineLastItem: Record<string, string> = {};
  
  for (const l of lineCodes) {
    lineLoad[l] = 0;
    lineLastItem[l] = ''; // 初始化为空，代表首次开工无换型惩罚
  }

  for (const mo of sortedOrders) {
    const routeData = routeMap.get(mo.itemId);
    // BLOCKER: 缺路线
    if (!routeData) {
      exceptions.push({
        prodId: mo.prodId,
        itemId: mo.itemId,
        exceptionType: 'MISSING_ROUTE',
        severity: 'BLOCKER',
        message: `无 Assembly 路线`,
      });
      continue;
    }
    const uph = routeData.uph;
    const headcount = routeData.headcount;

    const today = formatDate(new Date());
    const dlvStr =
      mo.dlvDate instanceof Date ? formatDate(mo.dlvDate) : mo.dlvDate ? String(mo.dlvDate).split('T')[0] : '';

    // 复合评分选线：产能 + 换型亲和 + 负载均衡
    const { capacity: w1, setupAffinity: w2, loadBalance: w3 } = MVP_CONFIG.lineSelectWeights;
    const maxLoad = Math.max(...lineCodes.map((l) => lineLoad[l]), 1); // 防止0
    const lineCapacities = new Map(lineCodes.map((l) => [l, pool.getTotalRemaining(l, today)]));
    const maxCap = Math.max(...lineCapacities.values(), 1);
    const rankedLines = lineCodes
      .map((line) => {
        const capScore = lineCapacities.get(line)! / maxCap;
        // 换型亲和得分：末次物料 === 当前订单物料 → 1 分，否则 0
        const affinityScore = lineLastItem[line] === mo.itemId ? 1 : 0;
        // 负载均衡得分：负载越低越好，归一化到 [0,1]
        const loadScore = 1 - lineLoad[line] / maxLoad;
        const score = w1 * capScore + w2 * affinityScore + w3 * loadScore;
        return { line, score };
      })
      .sort((a, b) => b.score - a.score)
      .map((x) => x.line);

    let bestResult: any = null;
    let foundIdeal = false;
    const maxLines = rankedLines.length;

    // 阶段 1：尝试标准产能（优先控制成本，逐步增加拆单线数）
    for (let numLines = 1; numLines <= maxLines; numLines++) {
      // 组合枚举：对 k 条线尝试所有 C(N,k) 组合
      const combos = numLines === 1
        ? rankedLines.map((l) => [l])  // 单线直接用排名
        : getCombinations(rankedLines, numLines);

      for (const linesToTry of combos) {
        // 后拉式排产：计算最晚开工日
        const setupH = linesToTry.some((l) => lineLastItem[l] !== mo.itemId) ? MVP_CONFIG.setupTimeHours : 0;
        const startFrom = calcLatestStart(pool, linesToTry, uph, mo.qtySched, setupH, dlvStr, today);
        const res = trySchedule(mo, linesToTry, pool, false, uph, dlvStr, today, lineLastItem, startFrom);

        if (res.success && res.finishDate <= dlvStr) {
          bestResult = res;
          foundIdeal = true;
          break;
        }
        if (
          !bestResult ||
          res.remaining < bestResult.remaining ||
          (res.remaining === 0 && res.finishDate < bestResult.finishDate)
        ) {
          bestResult = res;
        }
      }
      if (foundIdeal) break;
    }

    // 阶段 2：如果标准产能加满 100% 产线都无法满足交期，则尝试加班产能（同样组合枚举）
    if (!foundIdeal) {
      for (let numLines = 1; numLines <= maxLines; numLines++) {
        const combos = numLines === 1
          ? rankedLines.map((l) => [l])
          : getCombinations(rankedLines, numLines);

        for (const linesToTry of combos) {
          // 后拉式 + 加班：最晚开工日基于标准产能计算，加班作为额外补充
          const setupH = linesToTry.some((l) => lineLastItem[l] !== mo.itemId) ? MVP_CONFIG.setupTimeHours : 0;
          const startFrom = calcLatestStart(pool, linesToTry, uph, mo.qtySched, setupH, dlvStr, today);
          const res = trySchedule(mo, linesToTry, pool, true, uph, dlvStr, today, lineLastItem, startFrom);

          if (res.success && res.finishDate <= dlvStr) {
            bestResult = res;
            foundIdeal = true;
            break;
          }
          if (
            !bestResult ||
            res.remaining < bestResult.remaining ||
            (res.remaining === 0 && res.finishDate < bestResult.finishDate)
          ) {
            bestResult = res;
          }
        }
        if (foundIdeal) break;
      }
    }

    // 如果选出了最终方案，执行正式落库与扣减
    if (bestResult) {
      if (bestResult.remaining > 0) {
        exceptions.push({
          prodId: mo.prodId,
          itemId: mo.itemId,
          exceptionType: 'CALENDAR_EXHAUSTED',
          severity: 'BLOCKER',
          message: `超出 ${MVP_CONFIG.maxDays} 天仍有 ${Math.round(
            bestResult.remaining,
          )} 未排（已启用最多 ${maxLines} 条线并加双班）`,
        });
      }

      // 遍历最终使用的每一条线，进行尾差合并与产能扣减
      for (const line of bestResult.linesUsed) {
        const dp = bestResult.dailyPlans[line];
        const ep = bestResult.extraPlans[line] || {};
        if (!dp || Object.keys(dp).length === 0) continue;

        // 尾差合并：把 < 阈值 的碎片并入前一天
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

        let lineStartDate = '';
        let lineFinishDate = '';
        let lineTotalQty = 0;
        
        // 判定本次排产的实际换线耗时
        let lineSetupHours = 0;
        if (lineLastItem[line] !== mo.itemId) {
          lineSetupHours = MVP_CONFIG.setupTimeHours;
        }

        let isFirstDayToConsume = true;
        const finalDates = Object.keys(dp).sort();

        // 重新消耗确定好的产能
        for (const dateStr of finalDates) {
          const qty = dp[dateStr];
          
          let setupH = 0;
          if (isFirstDayToConsume) {
            setupH = lineSetupHours;
          }
          isFirstDayToConsume = false;
          
          // 修正尾差偷产能 Bug：重新计算准确的扣减标准工时
          const extraQty = ep[dateStr] || 0;
          const standardQty = Math.max(0, qty - extraQty);
          const totalStandardHoursNeeded = setupH + (standardQty / uph);
          
          // 最多扣减当天的剩余标准产能（防止超扣）
          const consumeH = Math.min(totalStandardHoursNeeded, pool.getRemaining(line, dateStr));
          pool.consume(line, dateStr, consumeH);

          lineTotalQty += qty;
          if (!lineStartDate || dateStr < lineStartDate) lineStartDate = dateStr;
          if (!lineFinishDate || dateStr > lineFinishDate) lineFinishDate = dateStr;
        }

        // 更新产线的最近生产物料记录
        lineLastItem[line] = mo.itemId;
        lineLoad[line] += (lineTotalQty / uph) + lineSetupHours;

        const overdueDays =
          lineFinishDate > dlvStr
            ? Math.ceil((new Date(lineFinishDate).getTime() - new Date(dlvStr).getTime()) / 86400000)
            : 0;

        let overdueType: 'ON_TIME' | 'AT_RISK' | 'PAST_DUE' = 'ON_TIME';
        if (dlvStr < today) {
          overdueType = 'PAST_DUE';
        } else if (overdueDays > 0) {
          overdueType = 'AT_RISK';
        }

        if (overdueType === 'AT_RISK') {
          exceptions.push({
            prodId: mo.prodId,
            itemId: mo.itemId,
            exceptionType: 'DELIVERY_AT_RISK',
            severity: 'WARNING',
            message: `产线 ${line} 预计完成 ${lineFinishDate}，超交期 ${overdueDays} 天`,
          });
        } else if (overdueType === 'PAST_DUE') {
          exceptions.push({
            prodId: mo.prodId,
            itemId: mo.itemId,
            exceptionType: 'PAST_DUE_SCHEDULED',
            severity: 'WARNING',
            message: `已过交期 ${dlvStr}，产线 ${line} 预计完成 ${lineFinishDate}`,
          });
        }

        // 输出按产线拆分的子订单排产结果
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
          candidateLines: lineCodes.join(','),
          chosenLine: line,
          uph,
          headcount,
          dailyPlan: dp,
          extraCapacityPlan: Object.keys(ep).length > 0 ? ep : null,
          setupTimeUsed: lineSetupHours, // 在结果中暴露换型时间
        });
      }
    }
  }

  // 计算产线利用率统计
  const lineUtilization = lineCodes.map((line) => {
    let totalCapacity = 0;
    let usedHours = 0;
    let activeCapacity = 0; // 仅有排产活动的天
    let activeUsed = 0;
    const peakDays: string[] = [];
    let firstActiveDay = '';
    let lastActiveDay = '';
    const today = formatDate(new Date());
    for (const [dateStr, hours] of pool.calendarMap) {
      if (dateStr < today) continue;
      totalCapacity += hours;
      const remaining = pool.getRemaining(line, dateStr);
      const used = hours - remaining;
      usedHours += used;
      if (used > 0.1) {
        // 有实际排产的天
        activeCapacity += hours;
        activeUsed += used;
        if (!firstActiveDay) firstActiveDay = dateStr;
        lastActiveDay = dateStr;
      }
      if (hours > 0 && used / hours > 0.95) peakDays.push(dateStr);
    }
    // 统计该线上排了多少单
    const orderCount = results.filter((r: any) => r.chosenLine === line).length;
    return {
      line,
      // 全日历利用率（从今天到年底）
      totalCapacityHours: Math.round(totalCapacity * 10) / 10,
      usedHours: Math.round(usedHours * 10) / 10,
      utilizationRate: totalCapacity > 0 ? Math.round((usedHours / totalCapacity) * 1000) / 10 : 0,
      // 活跃期利用率（仅有排产的天）— 体现实际繁忙程度
      activeCapacityHours: Math.round(activeCapacity * 10) / 10,
      activeUsedHours: Math.round(activeUsed * 10) / 10,
      activeRate: activeCapacity > 0 ? Math.round((activeUsed / activeCapacity) * 1000) / 10 : 0,
      // 排产窗口
      firstActiveDay,
      lastActiveDay,
      orderCount,
      peakDayCount: peakDays.length,
      peakDays: peakDays.slice(0, 10),
    };
  });

  return { results, exceptions, lineUtilization };
}

// ============================================================
// 引擎入口
// ============================================================
export async function runScheduling(ctx: Context) {
  // 步骤 1
  const allOrders = await step1_fetchOrders(ctx);
  ctx.logger?.info?.(`[Step 1] 加载 ${allOrders.length} 条订单`);

  // 步骤 2
  const { validOrders, exceptions: valEx } = step2_validate(allOrders);
  ctx.logger?.info?.(`[Step 2] 校验后 ${validOrders.length} 条有效, ${valEx.length} 条异常`);

  // 步骤 3
  const sortedOrders = step3_sort(validOrders);
  ctx.logger?.info?.(`[Step 3] 排序完成`);

  // 步骤 4
  const routeMap = await step4_fetchRoutes(ctx);
  ctx.logger?.info?.(`[Step 4] 加载 ${routeMap.size} 条 Assembly 路线`);

  // 步骤 5
  const lineCodes = await step5_fetchLines(ctx);
  ctx.logger?.info?.(`[Step 5] 可用产线: ${lineCodes.join(', ')}`);

  // 步骤 6
  const pool = await step6_buildHourPool(ctx, lineCodes);
  ctx.logger?.info?.(`[Step 6] 日历天数: ${pool.calendarMap.size}`);

  // 步骤 6-清旧数据
  const resultRepo = ctx.db.getRepository('schedule_results_v2');
  const excRepo = ctx.db.getRepository('schedule_exceptions_v2');
  // 先查后删（paginate: false 确保获取全部记录）
  const oldResults = await resultRepo.find({ fields: ['id'], paginate: false });
  if (oldResults.length > 0) {
    await resultRepo.destroy({ filterByTk: oldResults.map((r: any) => r.id) });
  }
  const oldExcs = await excRepo.find({ fields: ['id'], paginate: false });
  if (oldExcs.length > 0) {
    await excRepo.destroy({ filterByTk: oldExcs.map((r: any) => r.id) });
  }
  ctx.logger?.info?.(`[Step 6] 已清空 ${oldResults.length} 条旧结果, ${oldExcs.length} 条旧异常`);

  // 步骤 7-9
  const { results, exceptions: schedEx, lineUtilization } = scheduleAll(sortedOrders, routeMap, lineCodes, pool);
  ctx.logger?.info?.(`[Step 7-9] 排产完成: ${results.length} 条结果, ${schedEx.length} 条异常`);
  for (const lu of lineUtilization) {
    ctx.logger?.info?.(
      `  产线 ${lu.line}: ${lu.utilizationRate}% 利用率, ${lu.orderCount} 单, ${lu.peakDayCount} 天满载`,
    );
  }

  const allExceptions = [...valEx, ...schedEx];

  // 生成运行批次 ID: RUN_yyyyMMdd_HHmmss
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const runId = `RUN_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(
    now.getMinutes(),
  )}${pad(now.getSeconds())}`;

  // 给所有结果和异常打上 runId
  for (const r of results) r.runId = runId;
  for (const e of allExceptions) e.runId = runId;

  // 步骤 9-10：写回 NocoBase
  if (results.length > 0) {
    await resultRepo.create({ values: results });
    ctx.logger?.info?.(`[Step 9] 写入 ${results.length} 条排产结果`);
  }

  if (allExceptions.length > 0) {
    await excRepo.create({ values: allExceptions });
    ctx.logger?.info?.(`[Step 10] 写入 ${allExceptions.length} 条异常`);
  }

  // 步骤 11：写入排产运行记录
  const exceptionBreakdown: Record<string, number> = {};
  for (const e of allExceptions) {
    const t = e.exceptionType || 'UNKNOWN';
    exceptionBreakdown[t] = (exceptionBreakdown[t] || 0) + 1;
  }
  const successRate = validOrders.length > 0 ? Math.round((results.length / validOrders.length) * 1000) / 10 : 0;

  const runRepo = ctx.db.getRepository('schedule_runs');
  await runRepo.create({
    values: {
      runId,
      runTime: now.toISOString(),
      status: 'COMPLETED',
      totalOrders: allOrders.length,
      validOrders: validOrders.length,
      scheduledCount: results.length,
      exceptionCount: allExceptions.length,
      successRate,
      lineUtilization,
      exceptionBreakdown,
    },
  });
  ctx.logger?.info?.(`[Step 11] 写入运行记录: ${runId}, 成功率 ${successRate}%`);

  ctx.body = {
    success: true,
    runId,
    totalOrders: allOrders.length,
    validOrders: validOrders.length,
    results: results.length,
    exceptions: allExceptions.length,
    successRate,
    lineUtilization,
  };
}