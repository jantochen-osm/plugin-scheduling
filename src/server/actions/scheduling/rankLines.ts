/**
 * scheduling/rankLines.ts
 *
 * 候选产线评分与排名。
 *
 * 对每个候选产线按四个维度加权打分：
 *   - capScore:       窗口期内剩余产能 / 所需工时（≥1 时 saturate 到 1）
 *   - affinityScore:  上一单同品号则为 1（减少换型停机）
 *   - loadScore:      当前负载越轻得分越高
 *   - continuityScore:前单完成日与本单最早开工日间隔越短得分越高
 */

import { CapacityPool } from '../../engines';
import { formatDate } from './config';

/**
 * 对候选产线按综合得分排名，返回从高到低排列的产线代码数组。
 *
 * @param allowedLines   该订单允许使用的产线（来自客户映射或策略 fallback）
 * @param lineCodes      当次排产所有候选产线
 * @param lineLoad       各产线当前累计负载（工时）
 * @param lineLastItem   各产线最后一个排产物料 ID（换型亲和评分用）
 * @param lineLastFinish 各产线最后一个已提交订单的完成日期（衔接度评分用）
 * @param capacityPool   产能池
 * @param mo             当前订单
 * @param uph            有效 UPH（含人数）
 * @param earliestStart  最早可开工日期
 * @param targetDlv      目标交期（含 JIT 缓冲）
 * @param weights        四维评分权重
 */
export function rankCandidateLines(
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
      // 窗口期产能：earliestStart → targetDlv 内的可用工时累计
      let windowCap = 0;
      for (
        let d = new Date(earliestStart), dEnd = new Date(targetDlv);
        d <= dEnd;
        d.setDate(d.getDate() + 1)
      ) {
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
        if (gapDays <= 3) return 0.75; // 短暂空档（1–3 天）
        if (gapDays <= 7) return 0.40; // 较长空档（4–7 天）
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
