/**
 * scheduling/scheduleAll.ts
 *
 * 核心排产主循环。
 *
 * 对每一个订单，依次执行：
 *   1. 产线筛选（客户映射 + 物料路由 + 策略 fallback）
 *   2. UPH 查询（dn_operrouteline）
 *   3. 候选产线评分排名（rankCandidateLines）
 *   4. Combo 枚举 [人手] × [加班] × [提前天数] × [产线数] → bestResult
 *   5. 回溯增人（backtrackBoostHeadcount）— 当前单仍逾期时尝试对前序订单增人
 *   6. 提交 bestResult（commitBestResult），更新产能池 & 产线状态
 *
 * 子模块：
 *   rankLines.ts     — 产线评分
 *   commitResult.ts  — 提交最优方案
 *   backtrack.ts     — 回溯增人逻辑
 *   postProcess.ts   — 结果后处理（dailyPlan 清理 + 产线利用率）
 *   preOccupy.ts     — 锁定记录产能预占（供 reScheduleAfterAdjust 调用）
 */

import type { Context } from '@nocobase/actions';
import { RuleEngine, CapacityPool, StageDependencyManager } from '../../engines';
import type { SchedulingStrategy } from '../strategies';
import { addDays, formatDate, getTodayStr, SCHEDULING_CONFIG } from './config';
import { calcLatestStart } from './calcLatestStart';
import { getCombinations, tryScheduleStage } from './tryScheduleStage';
import type { SchedulingDecision } from '../llmDecision';
import type { LineHistEntry } from './types';
import { rankCandidateLines } from './rankLines';
import { commitBestResult } from './commitResult';
import { backtrackBoostHeadcount } from './backtrack';
import { cleanDailyPlans, calcLineUtilization } from './postProcess';

// 避免 TS unused-import 警告（CapacityPool 仅在参数类型中使用）
void (CapacityPool as any);

// ── 主排产函数 ───────────────────────────────────────────────────────
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
  const results: any[]    = [];
  const exceptions: any[] = [];
  const sdm = new StageDependencyManager();
  const today = getTodayStr();
  const cfg   = strategy.getConfig();

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

  // ── 产线状态追踪 ──────────────────────────────────────────────────
  const lineLoad:       Record<string, number>           = {};
  const lineLastItem:   Record<string, string>           = {};
  const lineLastFinish: Record<string, string>           = {};
  const lineHistory:    Record<string, LineHistEntry | null> = {};
  for (const l of lineCodes) {
    lineLoad[l] = 0; lineLastItem[l] = ''; lineLastFinish[l] = ''; lineHistory[l] = null;
  }

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

  // ── 主循环：逐订单排产 ────────────────────────────────────────────
  for (const mo of sortedOrders) {

    // ── LLM skip 判断 ──
    const dec = decisionMap?.get(mo.prodId);
    if (dec?.skip) {
      exceptions.push({
        prodId:        mo.prodId,
        itemId:        mo.itemId,
        exceptionType: 'LLM_SKIP',
        severity:      'WARNING',
        message:       dec.skipReason || 'LLM 判定该订单不适合本次排产，已跳过',
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

      // ESG 物料前缀路由：AMZ-55- / 55- 开头强制走 4F2（Chicha 线）
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
      const prevCompletion  = sdm.getPreviousStageCompletion(mo.prodId, stageName);
      const earliestStart   = prevCompletion ? addDays(prevCompletion, 1) : today;

      // JIT 缓冲：targetDlv 用于产线评分的窗口上限
      const bufferDlv = addDays(dlvStr, -cfg.jitBufferDays);
      const targetDlv = bufferDlv >= today ? bufferDlv : dlvStr;

      // ── 产线评分排名 ──
      let rankedLines = rankCandidateLines(
        allowedLines, lineCodes, lineLoad, lineLastItem,
        lineLastFinish, capacityPool, mo, uph, earliestStart, targetDlv, weights,
      );

      // LLM 引导：将 preferredLines 排在前面
      if (dec?.preferredLines?.length) {
        const preferred = dec.preferredLines.filter((l) => rankedLines.includes(l));
        const rest      = rankedLines.filter((l) => !preferred.includes(l));
        rankedLines = [...preferred, ...rest];
      }

      if (rankedLines.length === 0) {
        exceptions.push({ prodId: mo.prodId, itemId: mo.itemId, exceptionType: 'NO_AVAILABLE_LINE', severity: 'BLOCKER', message: `Stage ${stageName}: no available line` });
        continue;
      }

      // ── Combo 枚举：[人手] × [加班] × [提前开工天数] × [产线数] ──────────
      // 优先级：不加班 > 加班；早开工 > 晚开工；单线 > 多线
      let bestResult: any = null;
      const maxLines = rankedLines.length;

      const uphPerPerson    = uph / headcount;
      const maxHc           = Math.round(headcount * (cfg.maxHeadcountFactor ?? 4));
      const earlyStartMaxDays = cfg.earlyStartMaxDays ?? 7;

      for (let hc = headcount; hc <= maxHc; hc++) {
        if (bestResult?.finishDate <= dlvStr) break;
        const effectiveUph = Math.round(uphPerPerson * hc * 100) / 100;

        for (const allowOT of [false, true]) {
          if (bestResult?.finishDate <= dlvStr) break;
          // 增加人手时仅在单线试排（避免与多线叠加产生指数级组合）
          const maxNumLines = hc > headcount ? 1 : maxLines;

          for (let earlyDays = 0; earlyDays <= earlyStartMaxDays; earlyDays++) {
            if (earlyDays > 0 && bestResult?.finishDate <= dlvStr && !cfg.preferEarlyFinish) break;

            for (let numLines = 1; numLines <= maxNumLines; numLines++) {
              if (bestResult?.finishDate <= dlvStr && !cfg.preferEarlyFinish) break;

              const combos = numLines === 1
                ? rankedLines.slice(0, 1).map((l: string) => [l])
                : getCombinations(rankedLines.slice(0, Math.min(numLines, 4)), numLines);

              for (const linesToTry of combos) {
                const setupH = linesToTry.some((l: string) => lineLastItem[l] !== mo.itemId)
                  ? cfg.setupTimeHours : 0;

                // 顺序约束：若上一单当天还有剩余产能，下一单可复用同一天
                const primaryLine    = linesToTry[0] || '';
                const lineFinishDate = lineLastFinish[primaryLine] || '';
                const lineEarliestDate = lineFinishDate
                  ? (capacityPool.getAvailableHours(primaryLine, lineFinishDate) > 0
                    ? lineFinishDate
                    : addDays(lineFinishDate, 1))
                  : today;
                const effectiveEarliestStart = lineEarliestDate > earliestStart
                  ? lineEarliestDate : earliestStart;

                // JIT 基准起始日
                const jitStart = calcLatestStart(
                  capacityPool, linesToTry, effectiveUph, mo.qtySched, setupH,
                  targetDlv, effectiveEarliestStart, true,
                );

                // 接续优先 → JIT 兜底 → 提前开工
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

                // 附加元数据供 commitBestResult 读取
                if (res) {
                  (res as any)._hc                    = hc;
                  (res as any)._setupH                = setupH;
                  (res as any)._effectiveEarliestStart = effectiveEarliestStart;
                  (res as any)._earlyDays             = earlyDays;
                  (res as any)._allowOT               = allowOT;
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

      // ── 回溯增人（当前单仍逾期时） ────────────────────────────────────
      bestResult = backtrackBoostHeadcount({
        bestResult, mo, dlvStr, uph, headcount, uphPerPerson,
        earliestStart, targetDlv, earlyStartMaxDays, maxHc,
        rankedLines, lineHistory, lineLastFinish, lineLastItem, lineLoad,
        capacityPool, cfg, results,
      });

      // ── 异常记录 ──
      if (!bestResult || bestResult.remaining > 0) {
        exceptions.push({
          prodId: mo.prodId, itemId: mo.itemId,
          exceptionType: bestResult?.remaining > 0 ? 'CAPACITY_INSUFFICIENT' : 'SCHEDULE_FAILED',
          severity:      bestResult?.remaining > 0 ? 'WARNING' : 'BLOCKER',
          message:       `Stage ${stageName}: ${bestResult?.remaining > 0 ? `remaining ${Math.round(bestResult.remaining)}` : 'no feasible plan'}`,
        });
        if (!bestResult) continue;
      }

      // ── 提交最优方案 ──────────────────────────────────────────────────
      const primaryLineForHist    = rankedLines[0] || '';
      const lineFinishBeforeCommit = { ...lineLastFinish };
      const lineLoadBeforeCommit   = { ...lineLoad };
      const hcForCommit            = (bestResult as any)._hc ?? headcount;
      const effectiveUphForCommit  = Math.round(uphPerPerson * hcForCommit * 100) / 100;

      // 提交前快照（用于回溯时 release）
      const preAvailForHist: Record<string, Record<string, number>> = {};
      for (const line of (bestResult.linesUsed || [primaryLineForHist])) {
        preAvailForHist[line] = {};
        for (const date of Object.keys((bestResult.dailyPlans[line] as object) || {})) {
          preAvailForHist[line][date] = capacityPool.getAvailableHours(line, date);
        }
      }

      const committed = commitBestResult(
        mo, bestResult, allowedLines, stageName,
        uph,                   // routeUph: 工艺路线标准值（存 DB）
        effectiveUphForCommit,  // effectiveUph: 实际有效产能（算工时）
        headcount,             // 始终使用基础人力
        hcForCommit,           // actualHeadcount: 实际人数（用于 dailyPlanDetail）
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

      // 更新前序历史（供下一单回溯用）
      if (primaryLineForHist && committed.length > 0) {
        lineHistory[primaryLineForHist] = {
          orderRef:               mo,
          stageName,
          linesToTry:             bestResult.linesUsed || [primaryLineForHist],
          allowedLines,
          effectiveEarliestStart: (bestResult as any)._effectiveEarliestStart ?? today,
          targetDlvOfOrder:       targetDlv,
          dlvStr,
          uph,
          baseHeadcount:   headcount,
          headcountUsed:   hcForCommit,
          setupH:          (bestResult as any)._setupH ?? 0,
          allocatedPerLine,
          lineLoadDeltaPerLine,
          lineFinishBefore:   lineFinishBeforeCommit,
          resultStartIdx:     results.length - committed.length,
          resultCount:        committed.length,
        };
      }

      // 更新 SDM：记录本工段完成日期，供后续工段计算 earliestStart
      const stageFinish = committed.map((r) => r.finishDate).sort().pop();
      if (stageFinish) {
        sdm.recordStageCompletion(mo.prodId, stageName, stageFinish);
      }
    }
  }

  // ── 后处理 ────────────────────────────────────────────────────────
  cleanDailyPlans(results);
  const lineUtilization = calcLineUtilization(lineCodes, capacityPool, results);

  return { results, exceptions, lineUtilization };
}

// ── 重新导出 preOccupyPinnedResults（保持原有公共 API 不变）──────────
export { preOccupyPinnedResults } from './preOccupy';
