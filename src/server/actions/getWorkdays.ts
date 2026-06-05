/**
 * actions/getWorkdays.ts
 *
 * 路由：GET /api/scheduling:workdays?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 *
 * 从 md_work_calendars 查询指定日期范围内 isSchedulable=true 的工作日列表，
 * 供前端「按日期自动计算每日产量」功能使用。
 *
 * 返回：
 * {
 *   workdays: string[],              // 'YYYY-MM-DD' 数组，已排序
 *   workHours: Record<string, number> // 日期 → 工时（用于按比例分配）
 * }
 */

import type { Context } from '@nocobase/actions';

export async function getWorkdays(ctx: Context) {
  // NocoBase POST action 的 body 在 ctx.action.params.values 里
  // 同时兼容 GET query string（ctx.action.params / ctx.request.query）
  const values        = ctx.action?.params?.values   ?? {};
  const actionParams  = ctx.action?.params            ?? {};
  const requestQuery  = (ctx as any).request?.query   ?? {};

  const startDate: string = values.startDate || actionParams.startDate || requestQuery.startDate || '';
  const endDate:   string = values.endDate   || actionParams.endDate   || requestQuery.endDate   || '';

  ctx.logger?.info?.(`[getWorkdays] startDate=${startDate}, endDate=${endDate}`);

  if (!startDate || !endDate) {
    ctx.throw(400, `startDate 和 endDate 为必填参数（格式 YYYY-MM-DD）。values=${JSON.stringify(values)}`);
  }

  try {
    const [rows] = await ctx.db.sequelize.query(
      `SELECT "calendarDate", "workHours"
         FROM md_work_calendars
        WHERE "calendarDate" >= :startDate::date
          AND "calendarDate" <= :endDate::date
          AND "isSchedulable" = true
        ORDER BY "calendarDate"`,
      { replacements: { startDate, endDate } },
    ) as any;

    const workdays: string[] = [];
    const workHours: Record<string, number> = {};

    for (const row of rows as any[]) {
      // calendarDate 是 date 类型，Sequelize 会返回 Date 对象或字符串
      const dateStr = row.calendarDate instanceof Date
        ? row.calendarDate.toISOString().split('T')[0]
        : String(row.calendarDate).split('T')[0];
      workdays.push(dateStr);
      workHours[dateStr] = Number(row.workHours) || 10;
    }

    ctx.logger?.info?.(`[getWorkdays] result: ${workdays.length} workdays for ${startDate} ~ ${endDate}`);
    ctx.body = { workdays, workHours };
  } catch (e: any) {
    ctx.logger?.error?.('[getWorkdays] error: ' + (e?.message || e));
    ctx.throw(500, '查询工作日历失败：' + (e?.message || e));
  }
}

