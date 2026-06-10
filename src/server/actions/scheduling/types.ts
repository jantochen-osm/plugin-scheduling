/**
 * scheduling/types.ts
 *
 * 排产子模块共享类型定义。
 */

/** 前序订单提交历史，用于产能回溯与 OT 重排 */
export type LineHistEntry = {
  orderRef: any;
  stageName: string;
  linesToTry: string[];
  allowedLines: string[];
  effectiveEarliestStart: string;
  dlvStr: string;
  uph: number;
  baseHeadcount: number;
  headcountUsed: number;     // 实际使用的开工人数
  allowOT: boolean;          // 本次提交时是否允许加班
  setupH: number;
  allocatedPerLine: Record<string, Record<string, number>>;
  lineLoadDeltaPerLine: Record<string, number>;
  lineFinishBefore: Record<string, string>;
  resultStartIdx: number;
  resultCount: number;
};

/** 产线利用率统计条目 */
export type LineUtilEntry = {
  line: string;
  totalCapacityHours: number;
  usedHours: number;
  utilizationRate: number;
  orderCount: number;
};
