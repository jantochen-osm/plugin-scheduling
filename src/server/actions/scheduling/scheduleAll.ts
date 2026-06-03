/**
 * scheduling/scheduleAll.ts
 *
 * 核心排产循环。
 *
 * 对每一个订单，依次执行：
 *   1. 获取允许产线（customer_line_mapping → fallbackLines）
 *   2. 查询 UPH（dn_operrouteline）
 *   3. 对候选产线评分排名（产能 / 换型亲和 / 负载均衡）
 *   4. 枚举 [人手倍率 1x→2x] × [不加班→加班] × [单线→多线] 的组合，
 *      用 calcLatestStart + tryScheduleStage 找到最优方案（bestResult）
 *   5. 若当前单仍逾期，回溯尝试对前序订单翻倍人手，更早释放产线
 *   6. 提交 bestResult，更新产能池 & lineLastFinish 顺序约束
 *
 * 人手翻倍逻辑（headcountMult）：
 *   - 每次翻倍以 2x 为单位（UPH × 2），最多 1 次（maxHeadcountMult=2）
 *   - 翻倍人手时不叠加多线（双倍人手 ≈ 双线，避免指数级组合）
 *   - 回溯翻倍：当前单仍逾期时，对前序已提交订单翻倍人手，加快完成，
 *               早日释放产线，再重试当前单
 */

import type { Context } from '@nocobase/actions';
import { RuleEngine, CapacityPool, StageDependencyManager } from '../../engines';
import type { SchedulingStrategy } from '../strategies';
import { addDays, formatDate, getTodayStr, SCHEDULING_CONFIG } from './config';
import { calcLatestStart } from './calcLatestStart';
import { getCombinations, tryScheduleStage } from './tryScheduleStage';
import type { SchedulingDecision } from '../llmDecision';

/** 前序订单提交历史，用于产能回溯与人手翻倍 */
type LineHistEntry = {
  orderRef: any;
  stageName: string;
  linesToTry: string[];
  allowedLines: string[];
  effectiveEarliestStart: string;
  targetDlvOfOrder: string;
  dlvStr: string;
  uph: number;
  baseHeadcount: number;
  headcountUsed: number;     // 实际使用的开工人数（绝对值），基准人数或更多
  setupH: number;
  allocatedPerLine: Record<string, Record<string, number>>;
  lineLoadDeltaPerLine: Record<string, number>;
  lineFinishBefore: Record<string, string>;
  resultStartIdx: number;
  resultCount: number;
};


// ── 产线评分 ─────────────────────────────────────────────────────────
/**
 * 对候选产线按三个维度评分并排名：
 *   - capScore:       窗口期内剩余产能 / 所需工时（≥1 saturated to 1）
 *   - affinityScore:  上一单同品号则为 1（减少换型）
 *   - loadScore:      当前负载越轻得分越高
 */
function rankCandidateLines(
  allowedLines: string[],
  lineCodes: string[],
  lineLoad: Record<string, number>,
  lineLastItem: Record<string, string>,
  lineLastFinish: Record<string, string>,
  capacityPool: CapacityPool,
  mo: any,
  uph: number,
  earliestStart: string,
  targetDlv: string,
  weights: { capacity: number; setupAffinity: number; loadBalance: number; continuity: number },
): string[] {
  const maxLoad = Math.max(...lineCodes.map((l) => lineLoad[l] || 0), 1);
  const neededHours = uph > 0 ? mo.qtySched / uph : 1;

  return allowedLines
    .filter((l) => lineCodes.includes(l))
    .map((line) => {
      // 窗口期产能
      let windowCap = 0;
      for (let d = new Date(earliestStart), dEnd = new Date(targetDlv); d <= dEnd; d.setDate(d.getDate() + 1)) {
        windowCap += capacityPool.getAvailableHours(line, formatDate(d));
      }
      const capScore      = Math.min(windowCap / neededHours, 1.0);
      const affinityScore = lineLastItem[line] === mo.itemId ? 1 : 0;
      const loadScore     = 1 - (lineLoad[line] || 0) / maxLoad;

      // 衔接度评分：前单完成日与本单最早开始日间隔越短，分越高
      const continuityScore = (() => {
        const lastFinish = lineLastFinish[line] || '';
        if (!lastFinish) return 0.5; // 空线：中性分（不奖励也不惩罚）
        const msPerDay = 86400000;
        const gapDays = Math.round(
          (new Date(earliestStart).getTime() - new Date(lastFinish).getTime()) / msPerDay,
        );
        if (gapDays <= 1) return 1.0;  // 无缝衔接（前单完成日次日即开工）
        if (gapDays <= 3) return 0.75; // 短暂空档（1-3 天）
        if (gapDays <= 7) return 0.40; // 较长空档（4-7 天）
        return 0.10;                   // 断档超过 1 周，不鼓励
      })();

      const score = weights.capacity      * capScore
                  + weights.setupAffinity * affinityScore
                  + weights.loadBalance   * loadScore
                  + weights.continuity    * continuityScore;
      return { line, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.line);
}

// ── 提交最优方案 ─────────────────────────────────────────────────────
/**
 * 将 bestResult 写入产能池，记录排产结果，更新产线状态。
 * 返回本次提交的 result 记录数组（一个产线一条）。
 *
 * @param routeUph      工艺路线标准 UPH（存入 DB，不随人数变化）
 * @param effectiveUph  实际有效 UPH（= erpupph × 实际人数，用于产能分配计算）
 * @param headcount     标准开工人数（存入 DB）
 * @param actualHeadcount 实际开工人数（含增人，用于 dailyPlanDetail 计算展示）
 */
function commitBestResult(
  mo: any,
  bestResult: any,
  allowedLines: string[],
  stageName: string,
  routeUph: number,
  effectiveUph: number,
  headcount: number,
  actualHeadcount: number,
  dlvStr: string,
  today: string,
  lineLastItem: Record<string, string>,
  lineLoad: Record<string, number>,
  lineLastFinish: Record<string, string>,
  capacityPool: CapacityPool,
  cfg: ReturnType<SchedulingStrategy['getConfig']>,
): any[] {
  const committed: any[] = [];

  for (const line of bestResult.linesUsed) {
    const dp = bestResult.dailyPlans[line] || {};
    const ep = bestResult.extraPlans[line] || {};
    const sortedDates = Object.keys(dp).sort();

    // 尾单合并：末日产量低于 minTailQty 时并入前一天，减少换线频率
    for (let i = sortedDates.length - 1; i >= 1; i--) {
      if (dp[sortedDates[i]] < SCHEDULING_CONFIG.minTailQty && dp[sortedDates[i]] < dp[sortedDates[i - 1]]) {
        dp[sortedDates[i - 1]] += dp[sortedDates[i]];
        delete dp[sortedDates[i]];
        if (ep[sortedDates[i]]) delete ep[sortedDates[i]];
      }
    }

    const lineSetupHours = lineLastItem[line] !== mo.itemId ? cfg.setupTimeHours : 0;
    let isFirstDay = true;
    let lineStart = '';
    let lineFinish = '';
    let lineQty = 0;

    // 构建 dailyPlanDetail（计算构成明细）
    const perPersonUph = headcount > 0 ? routeUph / headcount : 0;
    const detailMap: Record<string, any> = {};

    // 正式分配产能（tryScheduleStage 已 rollback，此处重新 allocate）
    // 注意：使用 effectiveUph 计算工时（含人数倍增的实际产能）
    for (const dateStr of Object.keys(dp).sort()) {
      const qty = dp[dateStr];
      const setupH = isFirstDay ? lineSetupHours : 0;
      isFirstDay = false;
      const extraQty = ep[dateStr] || 0;
      const standardQty = Math.max(0, qty - extraQty);
      const totalH = setupH + standardQty / effectiveUph;
      capacityPool.allocate(line, dateStr, Math.min(totalH, capacityPool.getAvailableHours(line, dateStr) + (setupH || 0)));

      // 每日计算构成
      const dayInfo = capacityPool.getDayInfo(dateStr);
      detailMap[dateStr] = {
        totalQty: qty,
        standardQty,
        overtimeQty: extraQty,
        baseWorkHours: dayInfo.baseWorkHours,
        overtimeHours: effectiveUph > 0 ? Math.round((extraQty / effectiveUph) * 100) / 100 : 0,
        setupHours: setupH,
        effectiveHours: effectiveUph > 0
          ? Math.round(((standardQty / effectiveUph) + setupH) * 100) / 100
          : 0,
        uph: routeUph,
        perPersonUph: Math.round(perPersonUph * 100) / 100,
        headcount,
        actualHeadcount,
        effectiveUph: Math.round(effectiveUph * 100) / 100,
        dayType: qty > 0 && extraQty > 0 ? 'OVERTIME' : dayInfo.dayType,
        dayLabel: dayInfo.dayLabel,
      };

      lineQty += qty;
      if (!lineStart || dateStr < lineStart) lineStart = dateStr;
      if (!lineFinish || dateStr > lineFinish) lineFinish = dateStr;
    }

    // 更新产线状态
    lineLastItem[line] = mo.itemId;
    lineLoad[line] = (lineLoad[line] || 0) + lineQty / effectiveUph + lineSetupHours;
    // 顺序约束：记录本单完成日期，下一单必须在此之后才能开始
    if (lineFinish && (!lineLastFinish[line] || lineFinish > lineLastFinish[line])) {
      lineLastFinish[line] = lineFinish;
    }

    // Guard：跳过空结果
    if (lineQty <= 0 || !lineStart || !lineFinish || lineStart === 'Invalid date') continue;

    const overdueDays = lineFinish > dlvStr
      ? Math.ceil((new Date(lineFinish).getTime() - new Date(dlvStr).getTime()) / 86400000)
      : 0;
    const overdueType = dlvStr < today ? 'PAST_DUE' : overdueDays > 0 ? 'AT_RISK' : 'ON_TIME';

    committed.push({
      prodId: mo.prodId, itemId: mo.itemId, totalQty: lineQty,
      dlvDate: dlvStr, prodStatus: mo.prodStatus, prodPoolId: mo.prodPoolId, osmCategory: mo.osmCategory,
      startDate: lineStart, finishDate: lineFinish, isOverdue: overdueDays > 0,
      overdueDays, overdueType,
      candidateLines: allowedLines.join(','), chosenLine: line,
      uph: routeUph,    // DB 存工艺路线标准值（不随人数变化）
      headcount,        // DB 存标准基础人力（增加的人力只体现在 dailyPlan 数量上）
      dailyPlan: dp,
      dailyPlanDetail: detailMap,  // 每日排产计算构成
      extraCapacityPlan: Object.keys(ep).length > 0 ? ep : null,
      setupTimeUsed: lineSetupHours,
      costEstimate: bestResult.costEstimate,
      earlyStartDays: (bestResult as any)?._earlyDays ?? 0,     // 实际提前天数（0=JIT）
      isEarlyStart: ((bestResult as any)?._earlyDays ?? 0) > 0, // 是否提前开工
      isOvertime: (bestResult as any)?._allowOT ?? false,        // 是否使用加班
      stage: stageName,
    });

  }

  return committed;
}

// ── 主循环 ──────────────────────────────────────────────────────────
export async function scheduleAll(
  sortedOrders: any[],
  ruleEngine: RuleEngine,
  lineCodes: string[],
  capacityPool: CapacityPool,
  ctx: Context,
  strategy: SchedulingStrategy,
  /** LLM 决策图表（prodId → decision），缺省 undefined 走原算法 */
  decisionMap?: Map<string, SchedulingDecision>,
  /**
   * 可选：预置产线状态（来自锁定记录的 preOccupyPinnedResults 结果）。
   * 重算时传入，使排产感知已锁定记录占用的产线完成日期和最后物料。
   */
  initialState?: {
    lineLastFinish?: Record<string, string>;
    lineLastItem?: Record<string, string>;
  },
) {
  const results: any[] = [];
  const exceptions: any[] = [];
  const sdm = new StageDependencyManager();
  const today = getTodayStr();
  const cfg = strategy.getConfig();

  // 从所有订单的 _stages 收集真实 stageSequence，注册到 SDM
  const stageDefMap = new Map<string, number>();
  for (const o of sortedOrders) {
    for (const s of (o._stages || [])) {
      if (!stageDefMap.has(s.stageName)) {
        stageDefMap.set(s.stageName, (s as any).stageSequence ?? 99);
      }
    }
  }
  sdm.registerStages(
    [...stageDefMap.entries()].map(([stageName, stageSequence]) => ({ stageName, stageSequence })),
  );

  // 产线状态追踪
  const lineLoad: Record<string, number> = {};
  const lineLastItem: Record<string, string> = {};
  /** 顺序约束：记录每条产线最后一个已提交订单的完成日期 */
  const lineLastFinish: Record<string, string> = {};
  /** 各产线最近提交订单的历史，用于回溯翻倍人手 */
  const lineHistory: Record<string, LineHistEntry | null> = {};
  for (const l of lineCodes) { lineLoad[l] = 0; lineLastItem[l] = ''; lineLastFinish[l] = ''; lineHistory[l] = null; }

  // 若传入 initialState（重算场景），用锁定记录的产线状态覆盖初始值
  if (initialState?.lineLastFinish) {
    for (const [line, date] of Object.entries(initialState.lineLastFinish)) {
      if (date) lineLastFinish[line] = date;
    }
  }
  if (initialState?.lineLastItem) {
    for (const [line, item] of Object.entries(initialState.lineLastItem)) {
      if (item) lineLastItem[line] = item;
    }
  }

  const weights = cfg.lineSelectWeights;

  for (const mo of sortedOrders) {
    // ── LLM skip 判断 ──────────────────────────────────────────
    const dec = decisionMap?.get(mo.prodId);
    if (dec?.skip) {
      exceptions.push({
        prodId:        mo.prodId,
        itemId:        mo.itemId,
        exceptionType: 'LLM_SKIP',
        severity:      'WARNING',
        message:       dec.skipReason || 'LLM 浻判定该订单不适合本次排产，已跳过',
      });
      continue;
    }

    // ── 获取有效工段 ──
    let productStages: any[] = mo._stages || [];
    if (productStages.length === 0) {
      exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: 'NO_STAGE_MAPPING', severity: 'BLOCKER', message: 'No stage mapping' });
      continue;
    }
    const activeStages = strategy.getActiveStages();
    if (activeStages.length > 0) {
      productStages = productStages.filter((s: any) => activeStages.includes(s.stageName));
    }
    if (productStages.length === 0) continue;

    for (const stage of productStages) {
      const stageName = stage.stageName;

      // Debug: LLM decision for this order (if any)
      try {
        const ddbg = decisionMap?.get(mo.prodId);
        if (ddbg) console.log('[DEBUG][LLM_DECISION]', mo.prodId, JSON.stringify(ddbg));
      } catch (e) { /* ignore debug error */ }

      // ── 获取允许产线 ──
      let allowedLines: string[];
      if (mo.keyAccount) {
        const mapping = await ruleEngine.getCustomerLines(mo.keyAccount);
        allowedLines = (mapping && mapping.assignedLines.length > 0)
          ? mapping.assignedLines
          : strategy.getFallbackLines();
      } else {
        allowedLines = strategy.getFallbackLines();
      }

      // ESG 物料前缀路由：Amazon 客户中 itemId 以 AMZ-55- 或 55- 开头的物料
      // → 强制走 4F2（工厂内部称为 Chicha 线），优先级高于 customer_line_mapping 客户映射。
      // 注意：这类订单的 keyAccount 仍为 "Amazon"，并非独立客户，
      //       Chicha 是工厂对该产线/产品系列的内部叫法。
      if (strategy.name === 'ESG') {
        const itemId = mo.itemId || '';
        if (/^(AMZ-55-|55-)/i.test(itemId)) {
          allowedLines = ['4F2'];
        }
      }

      if (allowedLines.length === 0) {
        exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: 'NO_CANDIDATE_LINE', severity: 'BLOCKER', message: `Stage ${stageName}: no candidate lines` });
        continue;
      }

      // ── 查询 UPH ──
      let uph = 0;
      let headcount = 1;
      try {
        const routeRepo = ctx.db.getRepository('dn_operrouteline');
        const routes = await routeRepo.find({ filter: { item: mo.itemId, status: 1 }, paginate: false }) as any[];
        for (const r of routes) {
          if ((r.oper || '').toLowerCase().includes(stageName.toLowerCase()) && Number(r.erpupph) > 0) {
            headcount = Number(r.planninglabor) || 1;
            uph = Math.round(Number(r.erpupph) * headcount * 100) / 100;
            break;
          }
        }
      } catch { /* ignore */ }

      if (uph <= 0) {
        exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: 'NO_ROUTE', severity: 'BLOCKER', message: `Stage ${stageName}: no route for ${mo.itemId}` });
        continue;
      }

      const dlvStr = mo.dlvDate instanceof Date ? formatDate(mo.dlvDate) : String(mo.dlvDate || '').split('T')[0];
      const prevCompletion = sdm.getPreviousStageCompletion(mo.prodId, stageName);
      const earliestStart = prevCompletion ? addDays(prevCompletion, 1) : today;

      // JIT 缓冲：targetDlv 用于产线评分的窗口上限
      const bufferDlv = addDays(dlvStr, -cfg.jitBufferDays);
      const targetDlv = bufferDlv >= today ? bufferDlv : dlvStr;

      // ── 产线评分 ──
      let rankedLines = rankCandidateLines(
        allowedLines, lineCodes, lineLoad, lineLastItem,
        lineLastFinish,
        capacityPool, mo, uph, earliestStart, targetDlv, weights,
      );

      // Debug: show allowed and ranked lines
      try {
        console.log('[DEBUG][RANKED_LINES]', mo.prodId, 'allowed=', allowedLines, 'ranked=', rankedLines.slice(0, 10));
      } catch (e) {}

      // LLM 引导：将 preferredLines 排在前面（其余保持评分顺序追加）
      if (dec?.preferredLines?.length) {
        const preferred = dec.preferredLines.filter((l) => rankedLines.includes(l));
        const rest = rankedLines.filter((l) => !preferred.includes(l));
        rankedLines = [...preferred, ...rest];
      }

      if (rankedLines.length === 0) {
        exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: 'NO_AVAILABLE_LINE', severity: 'BLOCKER', message: `Stage ${stageName}: no available line` });
        continue;
      }

      // ── Combo 枚举：提前开工优先于加班 ──────────────────────────────────
      // 枚举顺序（优先级从高到低）：
      //   人手 → [不加班 → 加班] → 提前天数(0..earlyStartMaxDays) → 产线数
      // 保证"不加班+最大提前"仍优先于"加班+JIT"，提前开工从 JIT 基准日往前偏移，
      // 上限 earlyStartMaxDays（不超过此天数），交期缓冲（jitBufferDays）始终保留。
      let bestResult: any = null;
      const maxLines = rankedLines.length;

      // uphPerPerson：单人 UPH，每次递增 1 人
      const uphPerPerson = uph / headcount;
      // 最大尝试人数 = 基准人数 × maxHeadcountFactor（默认 4 倍）
      const maxHc = Math.round(headcount * (cfg.maxHeadcountFactor ?? 4));
      // 提前开工最大天数（从 JIT 基准日向前偏移，不超此值）
      const earlyStartMaxDays = cfg.earlyStartMaxDays ?? 7;

      for (let hc = headcount; hc <= maxHc; hc++) {
        if (bestResult?.finishDate <= dlvStr) break;
        // 保留 2 位小数，避免浮点误差（如 7.8087/15*20 = 156.17333...）
        const effectiveUph = Math.round(uphPerPerson * hc * 100) / 100;

        for (const allowOT of [false, true]) {
          if (bestResult?.finishDate <= dlvStr) break;
          // 增加人手时仅在单线试排（避免与多线叠加产生指数级组合）
          const maxNumLines = hc > headcount ? 1 : maxLines;

          // 提前开工枚举：earlyDays=0 为接续优先/JIT，earlyDays=N 为提前 N 天。
          // 只在以下两种情况继续枚举 earlyDays：
          //   1. 尚无准时方案（还在寻找）
          //   2. ESG(preferEarlyFinish)：更早完成更好，继续找更早结束的方案
          for (let earlyDays = 0; earlyDays <= earlyStartMaxDays; earlyDays++) {
            if (earlyDays > 0 && bestResult?.finishDate <= dlvStr && !cfg.preferEarlyFinish) break;


            for (let numLines = 1; numLines <= maxNumLines; numLines++) {
              if (bestResult?.finishDate <= dlvStr && !cfg.preferEarlyFinish) break;
              const combos = numLines === 1
                ? rankedLines.slice(0, 1).map((l: string) => [l])
                : getCombinations(rankedLines.slice(0, Math.min(numLines, 4)), numLines);

              for (const linesToTry of combos) {
                const setupH = linesToTry.some((l: string) => lineLastItem[l] !== mo.itemId) ? cfg.setupTimeHours : 0;

                // 顺序约束：本订单必须在该产线上一单完成后才能开始。
                // 优化：若上一单当天未用满产能，下一单可在同一天继续，充分利用剩余工时。
                const primaryLine = linesToTry[0] || '';
                const lineFinishDate = lineLastFinish[primaryLine] || '';
                const lineEarliestDate = lineFinishDate
                  ? (capacityPool.getAvailableHours(primaryLine, lineFinishDate) > 0
                    ? lineFinishDate               // 当天还有剩余产能，复用同一天
                    : addDays(lineFinishDate, 1))  // 当天已满，顺移至次日
                  : today;
                const effectiveEarliestStart = lineEarliestDate > earliestStart ? lineEarliestDate : earliestStart;

                // JIT 基准起始日（基于 targetDlv = bufferDlv，已含 jitBufferDays 缓冲）
                const jitStart = calcLatestStart(
                  capacityPool, linesToTry, effectiveUph, mo.qtySched, setupH,
                  targetDlv, effectiveEarliestStart, true,
                );

                // 接续优先 → JIT 兜底：
                //   若前单当天有剩余产能（lineEarliestDate == lineFinishDate），立刻接续；
                //   否则用 JIT 基准日（calcLatestStart），避免无谓提前开工。
                //   earlyDays>0 在 JIT 基础上进一步往前探索（如产能充裕时主动提前）。
                const hasSameDayResidue = lineFinishDate &&
                  capacityPool.getAvailableHours(primaryLine, lineFinishDate) > 0;
                const startFrom = earlyDays === 0
                  ? (hasSameDayResidue && lineFinishDate < jitStart ? lineFinishDate : jitStart)
                  : (() => {
                      const shifted = addDays(jitStart, -earlyDays);
                      return shifted >= effectiveEarliestStart ? shifted : effectiveEarliestStart;
                    })();

                const res = tryScheduleStage(
                  mo, linesToTry, capacityPool, allowOT, effectiveUph,
                  dlvStr, effectiveEarliestStart, lineLastItem, cfg.setupTimeHours, startFrom,
                );
                // Debug: log each attempt summary
                try {
                  console.log('[DEBUG][TRY]', mo.prodId, { hc, allowOT, earlyDays, linesToTry, effectiveUph, startFrom, res: res ? { success: res.success, finishDate: res.finishDate, remaining: res.remaining, cost: res?.costEstimate?.totalCost } : null });
                } catch (e) {}
                // 附加元数据：_hc / _earlyDays / _allowOT 供 commitBestResult 读取
                if (res) {
                  (res as any)._hc = hc;
                  (res as any)._setupH = setupH;
                  (res as any)._effectiveEarliestStart = effectiveEarliestStart;
                  (res as any)._earlyDays = earlyDays;
                  (res as any)._allowOT = allowOT;
                }

                if (res.success && res.finishDate <= dlvStr) {
                  const betterOnTime = !bestResult
                    || !bestResult.success || bestResult.finishDate > dlvStr
                    || (cfg.preferEarlyFinish
                      ? res.finishDate < bestResult.finishDate
                      : res.costEstimate.totalCost < bestResult.costEstimate.totalCost);
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
      }


      // Debug: bestResult after trying combos
      try {
        console.log('[DEBUG][BEST_RESULT]', mo.prodId, bestResult ? { finishDate: bestResult.finishDate, linesUsed: bestResult.linesUsed, remaining: bestResult.remaining, _hc: (bestResult as any)?._hc } : null);
      } catch (e) {}

      // ── 回溯增加前序订单人手（当前单仍逾期时）────────────────────────────

      // 对前序已提交订单递增人手，寻找使当前单交期达标的最小前序人数。
      if ((!bestResult || bestResult.finishDate > dlvStr) && rankedLines.length > 0) {
        const primaryLine = rankedLines[0];
        const hist = lineHistory[primaryLine];
        const prevMaxHc = Math.round((hist?.baseHeadcount ?? 1) * (cfg.maxHeadcountFactor ?? 4));

        if (hist && hist.headcountUsed < prevMaxHc) {
          // 1. 回滚前序订单的产能占用与 lineLoad
          for (const [ln, dateHoursMap] of Object.entries(hist.allocatedPerLine)) {
            for (const [date, hrs] of Object.entries(dateHoursMap)) {
              capacityPool.release(ln, date, hrs);
            }
          }
          for (const [ln, delta] of Object.entries(hist.lineLoadDeltaPerLine)) {
            lineLoad[ln] = Math.max(0, (lineLoad[ln] || 0) - delta);
          }
          const savedLineLastFinish = lineLastFinish[primaryLine];
          lineLastFinish[primaryLine] = hist.lineFinishBefore[primaryLine] || '';

          // 2. 双重搜索：增人 × 提前开工（先高效早开，同等条件下选最小增人）
          // 从基准人数起试（不强制+1）：提前开工可能无需增人即可让前序单更早完成
          const prevUphPerPerson = hist.uph / hist.baseHeadcount;
          let chosenBoostHc = hist.baseHeadcount;
          let chosenBoostEarlyDays = 0;
          let chosenBoostRes: any = null;

          BOOST_SEARCH:
          for (let bHc = hist.baseHeadcount; bHc <= prevMaxHc; bHc++) {
            const bUph = Math.round(prevUphPerPerson * bHc * 100) / 100;

            for (let bEarly = 0; bEarly <= earlyStartMaxDays; bEarly++) {
              const bJitStart = calcLatestStart(
                capacityPool, hist.linesToTry, bUph, hist.orderRef.qtySched, hist.setupH,
                hist.targetDlvOfOrder, hist.effectiveEarliestStart, true,
              );
              const bShifted = bEarly === 0 ? bJitStart : addDays(bJitStart, -bEarly);
              const bStartFrom = bShifted >= hist.effectiveEarliestStart
                ? bShifted : hist.effectiveEarliestStart;

              const bRes = tryScheduleStage(
                hist.orderRef, hist.linesToTry, capacityPool, false, bUph,
                hist.dlvStr, hist.effectiveEarliestStart, lineLastItem, cfg.setupTimeHours, bStartFrom,
              );
              if (!bRes.success) continue;

              chosenBoostRes       = bRes;
              chosenBoostHc        = bHc;
              chosenBoostEarlyDays = bEarly;

              // 估算：前序订单完成后，当前单能否准时（粗略：10h/天）
              const tentativeStart = bRes.finishDate > earliestStart ? bRes.finishDate : earliestStart;
              const neededDays = Math.ceil(mo.qtySched / uph / 10);
              const estimatedFinish = addDays(tentativeStart, neededDays);
              if (estimatedFinish <= dlvStr) break BOOST_SEARCH;
            }
          }
          // 确保 chosenBoostEarlyDays 已引用（防止 TS 未使用变量警告）
          void chosenBoostEarlyDays;

          if (chosenBoostRes && chosenBoostRes.success) {
            const boostUph = Math.round(prevUphPerPerson * chosenBoostHc * 100) / 100;
            // 3. 记录提交前快照
            const boostPreAvail: Record<string, Record<string, number>> = {};
            for (const ln of hist.linesToTry) {
              boostPreAvail[ln] = {};
              for (const date of Object.keys((chosenBoostRes.dailyPlans[ln] as object) || {})) {
                boostPreAvail[ln][date] = capacityPool.getAvailableHours(ln, date);
              }
            }
            const boostLineLoadBefore: Record<string, number> = {};
            for (const ln of hist.linesToTry) boostLineLoadBefore[ln] = lineLoad[ln] || 0;

            // 4. 提交前序订单的增人方案
            const boostCommitted = commitBestResult(
              hist.orderRef, chosenBoostRes, hist.allowedLines, hist.stageName,
              hist.uph,    // routeUph: 前序订单工艺路线标准值（存 DB）
              boostUph,    // effectiveUph: 增人后实际有效座产能（算工时）
              hist.baseHeadcount, // DB 存标准基础人力（增人只体现在 dailyPlan 上）
              chosenBoostHc,      // actualHeadcount: 增人后实际人数
              hist.dlvStr, today,
              lineLastItem, lineLoad, lineLastFinish, capacityPool, cfg,
            );
            // commitBestResult 只更新较晚的日期；增加人手后完成更早，需强制更新
            const boostFinish = boostCommitted.map((r: any) => r.finishDate).sort().pop() ?? '';
            if (boostFinish) lineLastFinish[primaryLine] = boostFinish;

            // 5. 更新 results[] 中前序订单的记录
            for (let i = 0; i < hist.resultCount; i++) {
              if (i < boostCommitted.length && hist.resultStartIdx + i < results.length) {
                results[hist.resultStartIdx + i] = boostCommitted[i];
              }
            }

            // 6. 更新前序订单的历史
            const newAllocatedPerLine: Record<string, Record<string, number>> = {};
            for (const [ln, preMap] of Object.entries(boostPreAvail)) {
              newAllocatedPerLine[ln] = {};
              for (const [date, pre] of Object.entries(preMap)) {
                const diff = pre - capacityPool.getAvailableHours(ln, date);
                if (diff > 0.001) newAllocatedPerLine[ln][date] = diff;
              }
            }
            const newLoadDelta: Record<string, number> = {};
            for (const ln of hist.linesToTry) {
              newLoadDelta[ln] = Math.max(0, (lineLoad[ln] || 0) - (boostLineLoadBefore[ln] || 0));
            }
            lineHistory[primaryLine] = {
              ...hist, headcountUsed: chosenBoostHc,
              allocatedPerLine: newAllocatedPerLine,
              lineLoadDeltaPerLine: newLoadDelta,
            };

            // 7. 用更新后的 lineLastFinish 重试当前订单（递增人手 + 提前开工，顺序同主 Combo 枚举）
            for (let hc = headcount; hc <= maxHc; hc++) {
              if (bestResult?.finishDate <= dlvStr) break;
              const effectiveUph = Math.round(uphPerPerson * hc * 100) / 100;
              for (const allowOT of [false, true]) {
                if (bestResult?.finishDate <= dlvStr) break;
                for (let earlyDays = 0; earlyDays <= earlyStartMaxDays; earlyDays++) {
                  if (bestResult?.finishDate <= dlvStr) break;
                  const lfDateR = lineLastFinish[primaryLine] || '';
                  const leDateR = lfDateR
                    ? (capacityPool.getAvailableHours(primaryLine, lfDateR) > 0 ? lfDateR : addDays(lfDateR, 1))
                    : today;
                  const eesR = leDateR > earliestStart ? leDateR : earliestStart;
                  const retrySetupH = lineLastItem[primaryLine] !== mo.itemId ? cfg.setupTimeHours : 0;
                  const jitStartR = calcLatestStart(
                    capacityPool, [primaryLine], effectiveUph, mo.qtySched, retrySetupH,
                    targetDlv, eesR, true,
                  );
                  const shiftedR = earlyDays === 0 ? jitStartR : addDays(jitStartR, -earlyDays);
                  const startFromR = shiftedR >= eesR ? shiftedR : eesR;
                  const retryRes = tryScheduleStage(
                    mo, [primaryLine], capacityPool, allowOT, effectiveUph,
                    dlvStr, eesR, lineLastItem, cfg.setupTimeHours, startFromR,
                  );
                  if (retryRes) {
                    (retryRes as any)._hc = hc;
                    (retryRes as any)._setupH = retrySetupH;
                    (retryRes as any)._effectiveEarliestStart = eesR;
                    (retryRes as any)._earlyDays = earlyDays;
                    (retryRes as any)._allowOT = allowOT;
                  }
                  if (retryRes.success && retryRes.finishDate <= dlvStr) {
                    const better = !bestResult || !bestResult.success || bestResult.finishDate > dlvStr
                      || (cfg.preferEarlyFinish
                        ? retryRes.finishDate < bestResult.finishDate
                        : retryRes.costEstimate.totalCost < bestResult.costEstimate.totalCost);
                    if (better) bestResult = retryRes;
                  } else if (!bestResult || !bestResult.success || bestResult.finishDate > dlvStr) {
                    if (!bestResult || retryRes.remaining < (bestResult.remaining ?? Infinity)) {
                      bestResult = retryRes;
                    }
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
            lineLastFinish[primaryLine] = savedLineLastFinish || '';
          }

        }
      }

      // ── 异常处理 ──
      if (!bestResult || bestResult.remaining > 0) {
        exceptions.push({
          prodId: mo.prodId, itemId: mo.itemId,
          exceptionType: bestResult?.remaining > 0 ? 'CAPACITY_INSUFFICIENT' : 'SCHEDULE_FAILED',
          severity: bestResult?.remaining > 0 ? 'WARNING' : 'BLOCKER',
          message: `Stage ${stageName}: ${bestResult?.remaining > 0 ? `remaining ${Math.round(bestResult.remaining)}` : 'no feasible plan'}`,
        });
        if (!bestResult) continue;
      }

      // ── 提交最优方案（含历史追踪）──────────────────────────────────────────
      const primaryLineForHist = rankedLines[0] || '';
      const lineFinishBeforeCommit = { ...lineLastFinish };
      const lineLoadBeforeCommit  = { ...lineLoad };
      // _hc: 本次实际使用的开工人数（绝对值）
      const hcForCommit           = (bestResult as any)._hc ?? headcount;
      const effectiveUphForCommit = Math.round(uphPerPerson * hcForCommit * 100) / 100;

      // 提交前快照（getAvailableHours diff → 计算实际分配工时，用于后续回滚）
      const preAvailForHist: Record<string, Record<string, number>> = {};
      for (const line of (bestResult.linesUsed || [primaryLineForHist])) {
        preAvailForHist[line] = {};
        for (const date of Object.keys((bestResult.dailyPlans[line] as object) || {})) {
          preAvailForHist[line][date] = capacityPool.getAvailableHours(line, date);
        }
      }

      const committed = commitBestResult(
        mo, bestResult, allowedLines, stageName,
        uph,                  // routeUph: 工艺路线标准值（存 DB）
        effectiveUphForCommit, // effectiveUph: 实际有效产能（算工时）
        headcount,            // 始终使用基础人力（增加的人力只体现在 dailyPlan 数量上）
        hcForCommit,          // actualHeadcount: 实际人数（用于 dailyPlanDetail）
        dlvStr, today, lineLastItem, lineLoad, lineLastFinish, capacityPool, cfg,
      );
      results.push(...committed);

      // 计算本次实际分配的工时（用于将来回溯时 release）
      const allocatedPerLine: Record<string, Record<string, number>> = {};
      for (const [line, preMap] of Object.entries(preAvailForHist)) {
        allocatedPerLine[line] = {};
        for (const [date, pre] of Object.entries(preMap)) {
          const diff = pre - capacityPool.getAvailableHours(line, date);
          if (diff > 0.001) allocatedPerLine[line][date] = diff;
        }
      }
      const lineLoadDeltaPerLine: Record<string, number> = {};
      for (const line of Object.keys(preAvailForHist)) {
        lineLoadDeltaPerLine[line] = Math.max(0, (lineLoad[line] || 0) - (lineLoadBeforeCommit[line] || 0));
      }

      // 更新前序历史（下一个订单可据此回溯）
      if (primaryLineForHist && committed.length > 0) {
        lineHistory[primaryLineForHist] = {
          orderRef: mo,
          stageName,
          linesToTry: bestResult.linesUsed || [primaryLineForHist],
          allowedLines,
          effectiveEarliestStart: (bestResult as any)._effectiveEarliestStart ?? today,
          targetDlvOfOrder: targetDlv,
          dlvStr,
          uph,
          baseHeadcount: headcount,
          headcountUsed: hcForCommit,  // 本次实际使用的绝对人数
          setupH: (bestResult as any)._setupH ?? 0,
          allocatedPerLine,
          lineLoadDeltaPerLine,
          lineFinishBefore: lineFinishBeforeCommit,
          resultStartIdx: results.length - committed.length,
          resultCount: committed.length,
        };
      }

      // 更新 SDM：记录本工段完成日期，供后续工段计算 earliestStart
      const stageFinish = committed.map((r) => r.finishDate).sort().pop();
      if (stageFinish) {
        sdm.recordStageCompletion(mo.prodId, stageName, stageFinish);
      }
    }
  }

  // 清理 dailyPlan + dailyPlanDetail：
  //   - dailyPlan 只保留 qty > 0 的日期（已有实际排产）
  //   - dailyPlanDetail 只保留 qty > 0 的日期（零值日期如周末/节假日不输出）
  //   - startDate/finishDate 已按 UTC 存储，前端可直接用于确定范围，不需要在这里补零
  for (const r of results) {
    const dp = r.dailyPlan || {};
    const detail = r.dailyPlanDetail || {};

    // 只保留有实际产量的日期
    const cleanPlan: Record<string, number> = {};
    const cleanDetail: Record<string, any> = {};

    for (const [d, qty] of Object.entries(dp)) {
      if ((qty as number) > 0) {
        cleanPlan[d] = qty as number;
        if (detail[d]) cleanDetail[d] = detail[d];
      }
    }

    r.dailyPlan = cleanPlan;
    r.dailyPlanDetail = cleanDetail;
  }


  // 产线利用率统计
  const lineUtilization = lineCodes.map((line) => {
    const totalCap = capacityPool.getMaxLoad(line);
    const used = capacityPool.getTotalLoad(line);
    return {
      line,
      totalCapacityHours: Math.round(totalCap * 10) / 10,
      usedHours: Math.round(used * 10) / 10,
      utilizationRate: totalCap > 0 ? Math.round((used / totalCap) * 1000) / 10 : 0,
      orderCount: results.filter((r: any) => r.chosenLine === line).length,
    };
  });

  return { results, exceptions, lineUtilization };
}

// ── 锁定记录产能预占 ──────────────────────────────────────────────────
/**
 * 将 isManualAdjusted=true 的锁定记录预先占用到产能池。
 *
 * 重算（reScheduleAfterAdjust）时调用：
 *   - 在 step5_initCapacityPool 之后、scheduleAll 之前执行
 *   - 锁定记录的 dailyPlan 按 uph 反推工时并 allocate 到产能池
 *
 * ⚠️ 设计决策：本函数「只预占产能，不更新 lineLastFinish / lineLastItem」
 *   锁定订单的语义是"该日期/产线的产能已承诺"，而不是"其他订单必须在它之后排"。
 *   若更新 lineLastFinish，调度器会把所有后续订单连锁推到锁定日期之后，
 *   导致高优先级逾期单也被错误延后，违背交期优先规则。
 *   lineLastFinish / lineLastItem 由 scheduleAll 主循环在排完每个非锁定订单后自动维护。
 *
 * @param pinnedResults   isManualAdjusted=true 的排产记录数组
 * @param capacityPool    已初始化的产能池（step5 产物）
 * @param lineLastFinish  保留参数（本函数不写入，由 scheduleAll 主循环维护）
 * @param lineLastItem    保留参数（本函数不写入，由 scheduleAll 主循环维护）
 */
export function preOccupyPinnedResults(
  pinnedResults: any[],
  capacityPool: CapacityPool,
  lineLastFinish: Record<string, string>,   // 保留签名兼容性，本函数不写入
  lineLastItem: Record<string, string>,     // 保留签名兼容性，本函数不写入
): void {
  const todayStr = getTodayStr();
  const skippedHistorical: string[] = [];

  for (const r of pinnedResults) {
    const line = r.chosenLine;
    if (!line) continue;

    const uph = Number(r.uph) || 1;
    const dailyPlan: Record<string, number> =
      typeof r.dailyPlan === 'string'
        ? JSON.parse(r.dailyPlan || '{}')
        : (r.dailyPlan || {});

    // 从 dailyPlan 取实际有效产量的最晚日期（不用 finishDate，可能是旧值）
    const validDates = Object.entries(dailyPlan)
      .filter(([, qty]) => (qty as number) > 0)
      .map(([d]) => d)
      .sort();
    const latestDailyPlanDate = validDates.at(-1) || '';

    // 历史日期锁定记录跳过：容量池从 today 起始，历史日期无产能槽，allocate 无效
    if (latestDailyPlanDate && latestDailyPlanDate < todayStr) {
      skippedHistorical.push(`${r.prodId}@${line}(latestDailyPlan=${latestDailyPlanDate})`);
      continue;
    }

    // ── 唯一操作：预占产能槽 ──────────────────────────────────────────
    // 不更新 lineLastFinish / lineLastItem，让非锁定订单按交期规则自由竞争空闲产能
    for (const [date, qty] of Object.entries(dailyPlan)) {
      const hours = (qty as number) / uph;
      if (hours > 0) capacityPool.allocate(line, date, hours);
    }
  }

  if (skippedHistorical.length > 0) {
    (preOccupyPinnedResults as any)._lastSkipped = skippedHistorical;
  }
}
