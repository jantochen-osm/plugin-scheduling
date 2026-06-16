import * as _dayjs from 'dayjs';

export const dayjs: any = _dayjs;

/** 数字格式化（处理 null/undefined/NaN，保留指定小数位） */
export const formatNum = (num: any, decimals = 0): number => {
  if (num === undefined || num === null || isNaN(num)) return 0;
  const n = Number(num);
  if (Math.abs(n) < 0.0001) return 0;
  return Number(n.toFixed(decimals));
};

/** ESG 产线列表（动态加载，初始值为硬编码降级） */
export let ESG_LINES: string[] = ['4F1', '4F2', '4F4', '4F6'];

/** ESG 产线颜色映射（动态加载） */
export let ESG_LINE_COLORS: Record<string, string> = {
  '4F1': '#ff7a45', '4F2': '#ffc53d', '4F4': '#73d13d', '4F6': '#40a9ff',
};

/**
 * 从 API 加载 ESG 产线配置
 * 应在应用启动时调用一次，失败时降级到硬编码默认值
 */
export async function loadESGLineConfig(api: any): Promise<void> {
  try {
    const res = await api.request({
      url: 'esg_line_config:list',
      method: 'get',
      params: { paginate: false, sort: ['sort'] },
    });
    const items = res?.data?.data || [];
    if (items.length > 0) {
      ESG_LINES = items
        .filter((i: any) => i.isActive)
        .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0))
        .map((i: any) => i.lineCode);
      ESG_LINE_COLORS = {};
      for (const item of items) {
        if (item.isActive) ESG_LINE_COLORS[item.lineCode] = item.color || '#40a9ff';
      }
    }
  } catch {
    // 降级：保持硬编码默认值
  }
}
