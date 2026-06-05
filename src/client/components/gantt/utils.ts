import * as _dayjs from 'dayjs';

export const dayjs: any = _dayjs;

/** 数字格式化（处理 null/undefined/NaN，保留指定小数位） */
export const formatNum = (num: any, decimals = 0): number => {
  if (num === undefined || num === null || isNaN(num)) return 0;
  const n = Number(num);
  if (Math.abs(n) < 0.0001) return 0;
  return Number(n.toFixed(decimals));
};

/** ESG 允许的产线 */
export const ESG_LINES = ['4F1', '4F2', '4F4', '4F6'] as const;
