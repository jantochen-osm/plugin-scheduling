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
      exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: 'MISSING_DLV_DATE', severity: 'BLOCKER', message: 'DlvDate 为空' });
      continue;
    }
    // BLOCKER: 交期已过（小于当天）
    const dlvDate = new Date(mo.dlvDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (dlvDate < today) {
      exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: 'PAST_DLV_DATE', severity: 'BLOCKER', message: `DlvDate=${mo.dlvDate} 已过交期` });
      continue;
    }
    // BLOCKER: 数量无效
    if (mo.qtySched <= 0) {
      exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: 'INVALID_QTY', severity: 'BLOCKER', message: `QtySched=${mo.qtySched}` });
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
// 步骤 3：多维优先级排序
//   优先级 1: 已逾期订单最优先（逾期天数越多越紧急）
//   优先级 2: 交期早的优先（EDD 最早交期规则）
// ============================================================
function step3_sort(orders: any[]) {
  return [...orders].sort((a, b) => {
    // 优先级 1: 逾期天数多的排前面
    const aOverdue = a.overdueDays || 0;
    const bOverdue = b.overdueDays || 0;
    if (aOverdue !== bOverdue) return bOverdue - aOverdue;

    // 优先级 2: 交期早的优先（EDD 规则）
    return new Date(a.dlvDate).getTime() - new Date(b.dlvDate).getTime();
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
  for (const l of lineCodes) lineLoad[l] = 0;

  for (const mo of sortedOrders) {
    const routeData = routeMap.get(mo.itemId);
    // BLOCKER: 缺路线
    if (!routeData) {
      exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: 'MISSING_ROUTE', severity: 'BLOCKER', message: `无 Assembly 路线` });
      continue;
    }
    const uph = routeData.uph;
    const headcount = routeData.headcount;

    const totalHours = mo.qtySched / uph;
    const today = formatDate(new Date());

    // 按总剩余产能降序排列候选产线
    const rankedLines = lineCodes
      .map(line => ({ line, total: pool.getTotalRemaining(line, today) }))
      .sort((a, b) => b.total - a.total)
      .map(x => x.line);

    let bestResult: { chosenLine: string; startDate: string; finishDate: string; dailyPlan: Record<string, number>; remaining: number } | null = null;

    // 逐线尝试：锁定单线排产，失败则换下一条线
    for (const tryLine of rankedLines) {
      if (pool.getTotalRemaining(tryLine, today) < totalHours * 0.5) continue; // 跳过明显不够的线

      let remainingQty = mo.qtySched;
      const dailyPlan: Record<string, number> = {};
      let startDate = '';
      let finishDate = '';
      let curDate = today;
      let dayCount = 0;
      // 记录本次尝试消耗的产能（用于回滚）
      const consumed: { line: string; date: string; hours: number }[] = [];

      while (remainingQty > 0 && dayCount < MVP_CONFIG.maxDays) {
        const dateStr = typeof curDate === 'string' ? curDate : formatDate(new Date(curDate));
        const remainingHours = pool.getRemaining(tryLine, dateStr);

        // 跳过产能不足的天（< 0.1h 视为浮点残留，避免零星排产）
        if (remainingHours < 0.1) {
          curDate = addDays(dateStr, 1);
          dayCount++;
          continue;
        }

        const maxQtyToday = remainingHours * uph;
        // 最后一批用 round（允许微量超产），中间批次用 floor（避免过度占用）
        const qtyToday = remainingQty <= maxQtyToday
          ? remainingQty  // 剩余全部放进今天
          : Math.floor(maxQtyToday);
        if (qtyToday <= 0) {
          curDate = addDays(dateStr, 1);
          dayCount++;
          continue;
        }
        const hoursToday = qtyToday / uph;

        pool.consume(tryLine, dateStr, hoursToday);
        consumed.push({ line: tryLine, date: dateStr, hours: hoursToday });
        dailyPlan[dateStr] = qtyToday;
        remainingQty -= qtyToday;

        if (!startDate) startDate = dateStr;
        finishDate = dateStr;

        if (remainingQty > 0) {
          curDate = addDays(dateStr, 1);
          dayCount++;
        }
      }

      if (remainingQty <= 0) {
        // 尾差合并：把 < 10 的碎片并入前一天
        const sortedDates = Object.keys(dailyPlan).sort();
        for (let i = sortedDates.length - 1; i >= 1; i--) {
          const curDay = sortedDates[i];
          const prevDay = sortedDates[i - 1];
          if (dailyPlan[curDay] < 10 && dailyPlan[curDay] < dailyPlan[prevDay]) {
            // 把碎片移到前一天，归还当天产能
            const fragment = dailyPlan[curDay];
            const fragHours = fragment / uph;
            dailyPlan[prevDay] += fragment;
            pool.restore(tryLine, curDay, fragHours);
            pool.consume(tryLine, prevDay, fragHours);
            // 更新 consumed 记录
            consumed.push({ line: tryLine, date: prevDay, hours: fragHours });
            consumed.push({ line: tryLine, date: curDay, hours: -fragHours });
            delete dailyPlan[curDay];
            // 更新 finishDate
            if (curDay === finishDate) finishDate = prevDay;
          }
        }

        // 排产成功，保留产能消耗
        bestResult = { chosenLine: tryLine, startDate, finishDate, dailyPlan, remaining: 0 };
        lineLoad[tryLine] += totalHours;
        break;
      } else {
        // 排产失败，回滚产能消耗
        for (const c of consumed) {
          pool.restore(c.line, c.date, c.hours);
        }
        // 记录最佳部分结果（如果没有任何线能排完，选排最多的）
        if (!bestResult || remainingQty < bestResult.remaining) {
          bestResult = { chosenLine: tryLine, startDate, finishDate, dailyPlan, remaining: remainingQty };
        }
      }
    }

    // 所有线都排不完 → 选排最多的那条线提交
    if (bestResult && bestResult.remaining > 0) {
      // 重新消耗最佳部分结果的产能
      for (const [dateStr, qty] of Object.entries(bestResult.dailyPlan)) {
        pool.consume(bestResult.chosenLine, dateStr, qty / uph);
      }
      lineLoad[bestResult.chosenLine] = (lineLoad[bestResult.chosenLine] || 0) + totalHours;
      exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: 'CALENDAR_EXHAUSTED', severity: 'BLOCKER', message: `超出 ${MVP_CONFIG.maxDays} 天仍有 ${Math.round(bestResult.remaining)} 未排（已尝试 ${rankedLines.length} 条线）` });
    }

    if (bestResult && bestResult.startDate) {
      const { chosenLine, startDate, finishDate, dailyPlan } = bestResult;
      // 步骤 9：输出 MO 结果（含 dailyPlan）
      const dlvStr = mo.dlvDate instanceof Date ? formatDate(mo.dlvDate) : mo.dlvDate;
      const todayStr = formatDate(new Date());
      const overdueDays = finishDate > dlvStr
        ? Math.ceil((new Date(finishDate).getTime() - new Date(dlvStr).getTime()) / 86400000)
        : 0;

      let overdueType: 'ON_TIME' | 'AT_RISK' | 'PAST_DUE' = 'ON_TIME';
      if (dlvStr < todayStr) {
        overdueType = 'PAST_DUE';
      } else if (overdueDays > 0) {
        overdueType = 'AT_RISK';
      }

      if (overdueType === 'AT_RISK') {
        exceptions.push({
          prodId: mo.prodId, itemId: mo.itemId,
          exceptionType: 'DELIVERY_AT_RISK',
          severity: 'WARNING',
          message: `排产逾期：预计完成 ${finishDate}，超交期 ${overdueDays} 天`,
        });
      } else if (overdueType === 'PAST_DUE') {
        exceptions.push({
          prodId: mo.prodId, itemId: mo.itemId,
          exceptionType: 'PAST_DUE_SCHEDULED',
          severity: 'WARNING',
          message: `已过交期 ${dlvStr}，预计完成 ${finishDate}`,
        });
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
        candidateLines: lineCodes.join(','),
        chosenLine: chosenLine || '',
        uph,
        headcount,
        dailyPlan: Object.keys(dailyPlan).length > 0 ? dailyPlan : null,
      });
    }
  }

  // 计算产线利用率统计
  const lineUtilization = lineCodes.map(line => {
    let totalCapacity = 0;
    let usedHours = 0;
    let activeCapacity = 0;  // 仅有排产活动的天
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
      if (used > 0.1) {  // 有实际排产的天
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
      utilizationRate: totalCapacity > 0 ? Math.round(usedHours / totalCapacity * 1000) / 10 : 0,
      // 活跃期利用率（仅有排产的天）— 体现实际繁忙程度
      activeCapacityHours: Math.round(activeCapacity * 10) / 10,
      activeUsedHours: Math.round(activeUsed * 10) / 10,
      activeRate: activeCapacity > 0 ? Math.round(activeUsed / activeCapacity * 1000) / 10 : 0,
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
    ctx.logger?.info?.(`  产线 ${lu.line}: ${lu.utilizationRate}% 利用率, ${lu.orderCount} 单, ${lu.peakDayCount} 天满载`);
  }

  const allExceptions = [...valEx, ...schedEx];

  // 生成运行批次 ID: RUN_yyyyMMdd_HHmmss
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const runId = `RUN_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

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
  const successRate = validOrders.length > 0
    ? Math.round(results.length / validOrders.length * 1000) / 10
    : 0;

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
