import { message } from 'antd';
import { dayjs } from './utils';

interface UseCalcDailyPlanParams {
  form: any;
  record: any;
  api: any;
  setPatchMap: (v: Record<string, number>) => void;
  setAddedDates: (v: Set<string>) => void;
  setAutoDates: (v: Set<string>) => void;
}

/**
 * useCalcDailyPlan
 *
 * 按日期自动计算每日产量的 custom hook。
 *
 * 支持 4 种输入场景：
 *   A. 两端都填  → 查 [start, finish] 范围内工作日，正向贪心填充
 *   B. 只填 startDate → 以 startDate 作为开工时间，向后查窗口，正向贪心填充，自动回填 finishDate
 *   C. 只填 finishDate → 估算窗口向前查，倒序贪心填充，自动回填 startDate
 *   D. 都不填   → 警告退出
 *
 * 每日满产能力 = floor(UPH × workHours)，按满产贪心排满，最后一天补差（加班处理）。
 * uph = 0 时降级为按 workHours 比例均摊。
 */
export const useCalcDailyPlan = ({
  form, record, api, setPatchMap, setAddedDates, setAutoDates,
}: UseCalcDailyPlanParams) => {

  const calcDailyPlan = async () => {
    const startVal  = form.getFieldValue('startDate');  
    const finishVal = form.getFieldValue('finishDate');

    // 场景 D：两端都没填
    if (!startVal && !finishVal) {
      message.warning('请至少填写开始日期或完成日期；开始日期会作为开工时间');
      return;
    }
    // 两端都填时，校验先后顺序
    if (startVal && finishVal && startVal.isAfter(finishVal)) {
      message.warning('开始日期不能晚于完成日期');
      return;
    }

    const totalQty = Number(record.totalQty) || 0;
    const uph      = Number(record.uph) || 0;

    // 估算查询窗口天数（保守取单日最小 8h，uph=0 时固定 90 天兜底）
    const estimateDays = uph > 0
      ? Math.min(Math.ceil(totalQty / (uph * 8)) * 2 + 30, 365)
      : 90;

    // 根据场景决定查询范围
    const mode: 'both' | 'onlyStart' | 'onlyFinish' =
      startVal && finishVal ? 'both'
      : startVal            ? 'onlyStart'
      :                       'onlyFinish';

    let queryStart: string;
    let queryEnd: string;
    if (mode === 'both') {
      queryStart = startVal.format('YYYY-MM-DD');
      queryEnd   = finishVal.format('YYYY-MM-DD');
    } else if (mode === 'onlyStart') {
      queryStart = startVal.format('YYYY-MM-DD');
      queryEnd   = startVal.add(estimateDays, 'day').format('YYYY-MM-DD');
    } else {
      queryStart = finishVal.subtract(estimateDays, 'day').format('YYYY-MM-DD');
      queryEnd   = finishVal.format('YYYY-MM-DD');
    }

    // Expand query range by 1 day on each side to prevent UTC timestamp
    // timezone shift from excluding the boundary dates (e.g. 2026-05-28 stored
    // as 2026-05-27T16:00:00Z is excluded by $gte: '2026-05-28T00:00:00Z').
    // Client-side string comparison below provides the exact boundary filter.
    const queryStartPadded = dayjs(queryStart).subtract(1, 'day').format('YYYY-MM-DD');
    const queryEndPadded   = dayjs(queryEnd).add(1, 'day').format('YYYY-MM-DD');

    // 查询工作日历（isSchedulable = true）
    let workdays: string[] = [];
    let workHoursMap: Record<string, number> = {};
    try {
      const res = await api.request({
        url: 'md_work_calendars:list',
        method: 'get',
        params: {
          paginate: false,
          pageSize: 500,
          sort: 'calendarDate',
          filter: JSON.stringify({
            $and: [
              { calendarDate: { $gte: queryStartPadded } }, // padded: avoids UTC timezone boundary miss
              { calendarDate: { $lte: queryEndPadded   } }, // padded: avoids UTC timezone boundary miss
              { isSchedulable: { $eq: true } },
            ],
          }),
        },
      });
      const rows: any[] = res?.data?.data || [];
      for (const r of rows) {
        const d = dayjs(r.calendarDate).format('YYYY-MM-DD');
        if (d) {
          workdays.push(d);
          workHoursMap[d] = Number(r.workHours) || 10;
        }
      }
      workdays.sort();
      // Client-side exact filter: trim padded rows back to the intended range
      workdays = workdays.filter((d) => d >= queryStart && d <= queryEnd);
    } catch (e: any) {
      message.error('查询工作日历失败：' + (e?.message || '未知错误'));
      return;
    }

    if (workdays.length === 0) {
      message.warning(`${queryStart} 至 ${queryEnd} 范围内无可排产工作日，请重新选择；开始日期会作为开工时间`);
      return;
    }

    // ── Query other locked orders on the same line that overlap our window ──────
    // Filters:
    //   1. Same line & locked by user
    //   2. Same runId -- avoid cross-version capacity pollution
    //   3. finishDate >= queryStart -- only orders that could overlap our window
    //      (this also makes the start-date visible in the API parameter)
    const usedByOthers: Record<string, number> = {};
    const runId: string | undefined = record.runId;
    if (record.chosenLine) {
      try {
        const lockedFilter: any[] = [
          { chosenLine:       { $eq: record.chosenLine } },
          { isManualAdjusted: { $eq: true              } },
          { id:               { $ne: record.id         } },
          { finishDate:       { $gte: queryStart       } }, // only orders overlapping our window
        ];
        if (runId) lockedFilter.push({ runId: { $eq: runId } }); // same version only
        const lockedRes = await api.request({
          url: 'schedule_results_v2:list',
          method: 'get',
          params: {
            paginate: false, pageSize: 500,
            fields: 'dailyPlan,startDate,finishDate',
            filter: JSON.stringify({ $and: lockedFilter }),
          },
        });
        const otherLocked: any[] = lockedRes?.data?.data || [];
        for (const r of otherLocked) {
          const plan: Record<string, number> =
            typeof r.dailyPlan === 'string' ? JSON.parse(r.dailyPlan || '{}') : (r.dailyPlan || {});
          for (const [date, qty] of Object.entries(plan)) {
            // only count dates within our scheduling window
            if (date >= queryStart && date <= queryEnd) {
              usedByOthers[date] = (usedByOthers[date] || 0) + Number(qty);
            }
          }
        }
      } catch (_) {
        // 查询失败则忽略，退化为不考虑他人占用
      }
    }

    // ── 贪心填充（正向 or 反向）────────────────────────────────────────────
    // 场景 B：startDate 是开工时间，必须保留为正向排产起点
    // 场景 C 倒序：确保 finishDate 一定有产量，startDate 为余量日
    const fillDays = mode === 'onlyFinish' ? [...workdays].reverse() : workdays;

    const newPatch: Record<string, number> = {};
    let remaining = totalQty;

    if (uph <= 0) {
      // 无 UPH：按 workHours 比例均摊（正向）
      const totalHours = workdays.reduce((s, d) => s + (workHoursMap[d] || 10), 0);
      let allocated = 0;
      workdays.forEach((d, i) => {
        if (i === workdays.length - 1) {
          newPatch[d] = totalQty - allocated;
        } else {
          const qty = Math.floor(totalQty * ((workHoursMap[d] || 10) / totalHours));
          newPatch[d] = qty;
          allocated  += qty;
        }
      });
      message.warning('⚠️ 该订单无 UPH 数据，已按工时比例均摊；开始日期仍作为开工时间');
    } else {
      for (let i = 0; i < fillDays.length; i++) {
        const d            = fillDays[i];
        const isLast       = i === fillDays.length - 1;
        const fullCap      = Math.floor(uph * (workHoursMap[d] || 10));
        const effectiveCap = Math.max(0, fullCap - (usedByOthers[d] || 0));

        if (remaining <= 0) break;
        if (effectiveCap === 0) continue;                           // 产能被同产线锁定订单占满，跳过

        if (isLast || remaining <= effectiveCap) {
          newPatch[d] = remaining;
          remaining = 0;
        } else {
          newPatch[d] = effectiveCap;
          remaining -= effectiveCap;
        }
      }
    }

    // 旧日期不在新计划里 → 置 0（在列表显示为「已删」）
    const newDateSet = new Set(Object.keys(newPatch).filter(d => (newPatch[d] || 0) > 0));
    for (const d of Object.keys(record.dailyPlan || {})) {
      if (!newDateSet.has(d)) newPatch[d] = 0;
    }

    // 实际使用的日期（有产量，升序）
    const usedDays = [...newDateSet].sort();

    // 回填表单日期（无论哪种场景，均以实际计算结果同步两端日期）
    if (usedDays.length > 0) {
      const calcedStart  = usedDays[0];
      const calcedFinish = usedDays[usedDays.length - 1];
      form.setFieldsValue({
        startDate:  dayjs(calcedStart),
        finishDate: dayjs(calcedFinish),
      });
    }

    setPatchMap(newPatch);
    setAddedDates(new Set());
    setAutoDates(new Set(usedDays));

    const calcedStart  = usedDays[0]  ?? queryStart;
    const calcedFinish = usedDays[usedDays.length - 1] ?? queryEnd;
    message.success(
      `✅ 已按满产能力排产，${calcedStart} ~ ${calcedFinish}，共 ${usedDays.length} 个工作日，合计 ${totalQty.toLocaleString()} 件；开始日期视为开工时间`
    );
  };

  return { calcDailyPlan };
};
