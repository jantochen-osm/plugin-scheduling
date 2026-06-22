/**
 * exportEsgExcel.ts
 *
 * 导出 ESG 排产计划 Excel 文件。
 * 路由：POST /api/scheduling:exportEsgExcel
 *
 * 逻辑：
 *   1. 取最新/指定 runId 的排产结果（ESG 策略）
 *   2. 关联 dn_production_order_ds 获取客户、项目名等信息
 *   3. 查询 md_work_calendars 获取工作日历
 *   4. 用 exceljs 生成高度还原 Demo 样式的 xlsx
 *   5. 返回 Buffer，浏览器触发下载
 *
 * Excel 布局（单 Sheet）：
 *   Row 1-5  : 全局头部（标题、保密声明、收发件人）
 *   每产线 Section（重复）：
 *     Row +0  : 产线名 + 周次标签（WK24/WK25...）
 *     Row +1  : 列头 (Item/Item code/Project Name...) + 日期序列
 *     Row +2  : 星期行 (SAT/SUN/MON...)
 *     Row +3  : Plan output-Day shift
 *     Row +4  : Plan output-Night shift  (合并 H:J)
 *     Row +5  : UPPH Target              (合并 H:J)
 *     Row +6  : Plan working hours-Day shift (合并 H:J)
 *     Row +7  : Plan working hours-Night shift (合并 H:J)
 *     Row +8  : MO No / MO qty / Bal Pro QTY 列头
 *     Row +9+ : 订单数据行
 *   空行分隔各 Section
 */

import type { Context } from '@nocobase/actions';
// exceljs 已在 node_modules 中存在（yarn.lock 已锁定）
const ExcelJS = require('exceljs');

// ── 产线代码 → 显示名映射 ──────────────────────────────────────────
const LINE_DISPLAY_NAME: Record<string, string> = {
  '4F1': '4F 1Line',
  '4F2': '4F 2Line',
  '4F3': '4F 3Line',
  '4F4': '4F 4Line',
  '4F5': '4F 5Line',
  '4F6': '4F 6Line',
  '9-Line2': '9-Line2',
  '9-Line3': '9-Line3',
  '9-Line4': '9-Line4',
  '9-Line6': '9-Line6',
};

// ── 列号辅助 ──────────────────────────────────────────────────────
/** 1→'A', 26→'Z', 27→'AA' */
function colLetter(n: number): string {
  let r = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    r = String.fromCharCode(65 + m) + r;
    n = Math.floor((n - 1) / 26);
  }
  return r;
}

// ── 日期工具 ──────────────────────────────────────────────────────
function toDateStr(d: any): string {
  if (!d) return '';
  if (typeof d === 'string') return d.split('T')[0];
  if (d instanceof Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }
  return String(d).split('T')[0];
}

/** 生成两个日期之间的所有日期（含端点） */
function dateRange(from: string, to: string): string[] {
  const result: string[] = [];
  const cur = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (cur <= end) {
    result.push(toDateStr(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

/** 周次标签：ISO week number，含年份 */
function getWeekLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const weekNum = Math.ceil(((d.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7);
  return `WK${weekNum}`;
}

/** 星期缩写 */
const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

// ── Excel 序列日期（1900年起） ─────────────────────────────────────
function toExcelDate(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00');
  const epoch = new Date('1899-12-31T00:00:00');
  return Math.round((d.getTime() - epoch.getTime()) / 86400000);
}

// ── 样式常量 ──────────────────────────────────────────────────────
const FONT_BASE = { name: 'Calibri', size: 10 };
const FONT_BOLD = { name: 'Calibri', size: 10, bold: true };
const FONT_SMALL = { name: 'Calibri', size: 8 };
const FONT_TITLE = { name: 'Calibri', size: 14, bold: true };

const BORDER_THIN: any = {
  top: { style: 'thin', color: { argb: 'FFB0B0B0' } },
  left: { style: 'thin', color: { argb: 'FFB0B0B0' } },
  bottom: { style: 'thin', color: { argb: 'FFB0B0B0' } },
  right: { style: 'thin', color: { argb: 'FFB0B0B0' } },
};
const BORDER_MEDIUM_BOTTOM: any = {
  ...BORDER_THIN,
  bottom: { style: 'medium', color: { argb: 'FF808080' } },
};

// 背景色
const BG_GLOBAL_TITLE  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } } as any; // 浅橙
const BG_LINE_HEADER   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } } as any; // 深蓝
const BG_COL_HEADER    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E75B6' } } as any; // 蓝
const BG_DATE_ROW      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDAE3F3' } } as any; // 浅蓝
const BG_PLAN_DAY      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } } as any; // 浅绿
const BG_PLAN_NIGHT    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } } as any; // 浅黄
const BG_UPPH          = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEDED' } } as any; // 浅灰
const BG_WH_DAY        = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAD3' } } as any; // 浅绿2
const BG_WH_NIGHT      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9C4' } } as any; // 浅黄2
const BG_MO_HEADER     = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } } as any; // 蓝灰
const BG_WHITE         = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } } as any;
const BG_REST_DAY      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEDED' } } as any; // 休息日

// ── 批量设置行样式工具 ─────────────────────────────────────────────
function applyRowStyle(
  row: any,
  fill: any,
  font: any = FONT_BASE,
  alignment: any = { horizontal: 'center', vertical: 'middle', wrapText: false },
  border: any = BORDER_THIN,
) {
  row.eachCell({ includeEmpty: true }, (cell: any) => {
    if (fill) cell.fill = fill;
    cell.font = font;
    cell.alignment = alignment;
    if (border) cell.border = border;
  });
}

/** 为指定行的日期列（colStart ~ colEnd）应用填充色 */
function applyDateColsFill(row: any, colStart: number, colEnd: number, fillFn: (colIdx: number) => any) {
  for (let c = colStart; c <= colEnd; c++) {
    const cell = row.getCell(c);
    const fill = fillFn(c);
    if (fill) cell.fill = fill;
  }
}

// ── 主 Action ─────────────────────────────────────────────────────
export async function exportEsgExcel(ctx: Context) {
  console.log('[exportEsgExcel] ===== ACTION CALLED =====');
  console.log('[exportEsgExcel] method:', ctx.method);
  console.log('[exportEsgExcel] path:', ctx.path);
  // ── 1. 确定 runId ────────────────────────────────────────────────
  const body = (ctx.action?.params?.values ?? ctx.request?.body ?? {}) as any;
  let runId: string | undefined = body.runId;

  if (!runId) {
    const [rows] = await ctx.db.sequelize.query(
      `SELECT "runId" FROM schedule_runs ORDER BY "runTime" DESC LIMIT 1`,
    ) as any;
    runId = rows?.[0]?.runId;
  }

  if (!runId) {
    ctx.status = 404;
    ctx.body = { error: '暂无排产数据，请先执行排产' };
    return;
  }

  // ── 2. 拉取 ESG 排产结果 ─────────────────────────────────────────
  const [resultRows] = await ctx.db.sequelize.query(
    `SELECT "prodId","itemId","totalQty","dlvDate","startDate","finishDate",
            "chosenLine","uph","headcount","dailyPlan","dailyPlanDetail",
            "osmCategory","isOverdue","isManualAdjusted"
     FROM schedule_results_v2
     WHERE "runId" = :runId AND "osmCategory" = 'ESG'
     ORDER BY "chosenLine", "startDate"`,
    { replacements: { runId } },
  ) as any;

  if (!resultRows || resultRows.length === 0) {
    ctx.status = 404;
    ctx.body = { error: '该版本无 ESG 排产数据' };
    return;
  }

  // ── 3. 关联查询订单表（获取 customer / project / prodgroupid / remarks）
  const prodIds = [...new Set(resultRows.map((r: any) => r.prodId))] as string[];

  // Sequelize 命名参数 + 数组：IN (:prodIds) 会被自动展开为 IN ('id1','id2',...)
  // 不能用 ANY(:prodIds::text[])，Sequelize 不支持该语法
  const [orderRows] = await ctx.db.sequelize.query(
    `SELECT prodid, keyaccount, project, prodgroupid, osm_remarks, itemid
     FROM dn_production_order_ds
     WHERE prodid IN (:prodIds)`,
    { replacements: { prodIds } },
  ) as any;

  const orderMap: Record<string, any> = {};
  (orderRows || []).forEach((o: any) => { orderMap[o.prodid] = o; });

  // ── 4. 解析 dailyPlan，计算全局日期范围 ──────────────────────────
  let globalMin = '';
  let globalMax = '';

  const records = resultRows.map((r: any) => {
    const dailyPlan = typeof r.dailyPlan === 'string' ? JSON.parse(r.dailyPlan || '{}') : (r.dailyPlan || {});
    const s = toDateStr(r.startDate);
    const f = toDateStr(r.finishDate);
    if (!globalMin || s < globalMin) globalMin = s;
    if (!globalMax || f > globalMax) globalMax = f;
    const order = orderMap[r.prodId] || {};
    return {
      ...r,
      dailyPlan,
      customer:    order.keyaccount || '',
      projectName: order.project    || '',
      type:        order.prodgroupid || 'MP',
      remark:      order.osm_remarks || '',
      startDateStr: s,
      finishDateStr: f,
    };
  });

  // ── 5. 查询工作日历 ────────────────────────────────────────────────
  let calendarMap: Record<string, boolean> = {}; // date → isWorkday
  if (globalMin && globalMax) {
    const [calRows] = await ctx.db.sequelize.query(
      `SELECT "calendarDate"::text, "isWorkday"
       FROM md_work_calendars
       WHERE "calendarDate" >= :from AND "calendarDate" <= :to`,
      { replacements: { from: globalMin, to: globalMax } },
    ) as any;
    (calRows || []).forEach((c: any) => {
      const ds = String(c.calendarDate).split('T')[0];
      calendarMap[ds] = !!c.isWorkday;
    });
  }

  // 工作日判断：先查日历，再回退到周六/周日
  function isRestDay(dateStr: string): boolean {
    if (calendarMap[dateStr] !== undefined) return !calendarMap[dateStr];
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    return dow === 0 || dow === 6;
  }

  // ── 6. 按产线分组 ──────────────────────────────────────────────────
  const lineMap: Record<string, any[]> = {};
  records.forEach((r: any) => {
    const line = r.chosenLine || 'Unknown';
    if (!lineMap[line]) lineMap[line] = [];
    lineMap[line].push(r);
  });
  const sortedLines = Object.keys(lineMap).sort();

  // ── 7. 计算全局日期列（全量日期范围） ─────────────────────────────
  const allDates = globalMin && globalMax ? dateRange(globalMin, globalMax) : [];

  // 将日期分组为周（按自然周，Mon-Sun）
  const weekGroups: { weekLabel: string; dates: string[] }[] = [];
  const weekLabelSeen: string[] = [];
  allDates.forEach(d => {
    const wl = getWeekLabel(d);
    let grp = weekGroups.find(g => g.weekLabel === wl);
    if (!grp) {
      grp = { weekLabel: wl, dates: [] };
      weekGroups.push(grp);
      weekLabelSeen.push(wl);
    }
    grp.dates.push(d);
  });

  // ── 8. 列布局定义 ─────────────────────────────────────────────────
  // 固定列 A-K (1-11)：A=序号/产线名, B=Item code, C=Project Name, D=Customer,
  //   E=STD worker qty, F=Remark, G=Type, H=MO No(数据)/计划标签(头部), I=MO qty, J=Bal Pro QTY, K=分隔
  const FIXED_COLS = 11; // A~K
  const DATE_COL_START = 12; // L 列起始
  const dateCols = allDates; // 每日一列
  const totalCols = FIXED_COLS + dateCols.length;

  // ── 9. 构建 Workbook ──────────────────────────────────────────────
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'OSM Scheduling';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('MP Assembly Line', {
    pageSetup: { fitToPage: true, fitToWidth: 1, orientation: 'landscape' },
  });

  // 列宽设置
  sheet.getColumn(1).width  = 6;    // A: 序号
  sheet.getColumn(2).width  = 22;   // B: Item code
  sheet.getColumn(3).width  = 28;   // C: Project Name
  sheet.getColumn(4).width  = 14;   // D: Customer
  sheet.getColumn(5).width  = 10;   // E: STD worker qty
  sheet.getColumn(6).width  = 32;   // F: Remark
  sheet.getColumn(7).width  = 8;    // G: Type
  sheet.getColumn(8).width  = 16;   // H: MO No
  sheet.getColumn(9).width  = 10;   // I: MO qty
  sheet.getColumn(10).width = 12;   // J: Bal Pro QTY
  sheet.getColumn(11).width = 2;    // K: 分隔
  // 日期列统一 8.5 宽
  for (let c = DATE_COL_START; c <= totalCols; c++) {
    sheet.getColumn(c).width = 8.5;
  }

  // ── 10. 全局头部 (Rows 1-5) ─────────────────────────────────────
  let currentRow = 1;

  // Row 1: 标题
  const r1 = sheet.getRow(currentRow++);
  sheet.mergeCells(`A1:G1`);
  r1.getCell(1).value = 'MD Production schedule.';
  r1.getCell(1).font = FONT_TITLE;
  r1.getCell(1).fill = BG_GLOBAL_TITLE;
  r1.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
  r1.getCell(5).value = 'Update date';
  r1.getCell(5).font = FONT_BOLD;
  // Update date 值：今天
  r1.getCell(6).value = new Date();
  r1.getCell(6).numFmt = 'yyyy/mm/dd';
  r1.getCell(6).font = FONT_BASE;
  r1.height = 22;

  // Row 2-5: 声明
  const disclaimers = [
    'Statement of Confidential (机密文件)',
    'Non-Used of Banned Substances (本文件使用SS-00259中规定的禁止使用物质;)',
    `TO: MD/QMD/PE/WH/MC`,
    `FR: Ann/Penny/Jim`,
  ];
  disclaimers.forEach(text => {
    const row = sheet.getRow(currentRow++);
    sheet.mergeCells(`A${currentRow - 1}:${colLetter(totalCols)}${currentRow - 1}`);
    row.getCell(1).value = text;
    row.getCell(1).font = FONT_SMALL;
    row.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
    row.height = 14;
  });

  // ── 11. 各产线 Section ────────────────────────────────────────────
  for (const lineCode of sortedLines) {
    const lineRecords = lineMap[lineCode];
    const lineName = LINE_DISPLAY_NAME[lineCode] || lineCode;

    // ── Section Row 0: 产线名 + 周次标签 ─────────────────────────
    const secHeaderRow = sheet.getRow(currentRow++);
    secHeaderRow.height = 18;

    // 产线名（合并 A:G）
    sheet.mergeCells(`A${currentRow - 1}:G${currentRow - 1}`);
    secHeaderRow.getCell(1).value = lineName;
    secHeaderRow.getCell(1).font = { ...FONT_BOLD, color: { argb: 'FFFFFFFF' }, size: 12 };
    secHeaderRow.getCell(1).fill = BG_LINE_HEADER;
    secHeaderRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };

    // 周次标签（在每周第一列显示 WK 标签）
    secHeaderRow.getCell(8).fill = BG_LINE_HEADER; // H 列保持同色
    secHeaderRow.getCell(9).fill = BG_LINE_HEADER;
    secHeaderRow.getCell(10).fill = BG_LINE_HEADER;
    secHeaderRow.getCell(11).fill = BG_LINE_HEADER; // K 分隔

    weekGroups.forEach(wg => {
      const firstColIdx = DATE_COL_START + dateCols.indexOf(wg.dates[0]);
      secHeaderRow.getCell(firstColIdx).value = wg.weekLabel;
      secHeaderRow.getCell(firstColIdx).font = { ...FONT_BOLD, color: { argb: 'FFFFFFFF' } };
      secHeaderRow.getCell(firstColIdx).alignment = { horizontal: 'left', vertical: 'middle' };
      // 同周合并（可选）
      if (wg.dates.length > 1) {
        const lastColIdx = firstColIdx + wg.dates.length - 1;
        sheet.mergeCells(
          `${colLetter(firstColIdx)}${currentRow - 1}:${colLetter(lastColIdx)}${currentRow - 1}`,
        );
      }
      // 背景
      for (let i = 0; i < wg.dates.length; i++) {
        secHeaderRow.getCell(firstColIdx + i).fill = BG_LINE_HEADER;
      }
    });

    // ── Section Row 1: 列头 + 日期序列 ─────────────────────────────
    const colHeaderRow = sheet.getRow(currentRow++);
    colHeaderRow.height = 16;
    const colHeaders = ['Item', 'Item code', 'Project Name', 'Customer',
      'STD worker qty', 'Remark', 'Type', 'Type', '', '', ''];
    colHeaders.forEach((h, i) => {
      const cell = colHeaderRow.getCell(i + 1);
      cell.value = h;
      cell.font = FONT_BOLD;
      cell.fill = BG_COL_HEADER;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = BORDER_THIN;
      if (h) cell.font = { ...FONT_BOLD, color: { argb: 'FFFFFFFF' } };
    });
    // H:J 合并（表头）
    sheet.mergeCells(
      `H${currentRow - 1}:J${currentRow - 1}`,
    );

    dateCols.forEach((d, i) => {
      const cell = colHeaderRow.getCell(DATE_COL_START + i);
      cell.value = toExcelDate(d);
      cell.numFmt = 'm/d';
      cell.font = { ...FONT_BOLD, color: { argb: 'FFFFFFFF' } };
      cell.fill = isRestDay(d) ? BG_REST_DAY : BG_COL_HEADER;
      if (isRestDay(d)) cell.font = { ...FONT_BOLD, color: { argb: 'FFFF4D4F' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = BORDER_THIN;
    });

    // ── Section Row 2: 星期行 ──────────────────────────────────────
    const dayRow = sheet.getRow(currentRow++);
    dayRow.height = 14;
    for (let c = 1; c <= FIXED_COLS; c++) {
      dayRow.getCell(c).fill = BG_DATE_ROW;
      dayRow.getCell(c).border = BORDER_THIN;
    }
    dateCols.forEach((d, i) => {
      const dow = new Date(d + 'T00:00:00').getDay();
      const cell = dayRow.getCell(DATE_COL_START + i);
      cell.value = DAY_NAMES[dow];
      cell.font = isRestDay(d)
        ? { ...FONT_BOLD, color: { argb: 'FFFF4D4F' } }
        : FONT_BOLD;
      cell.fill = BG_DATE_ROW;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = BORDER_THIN;
    });

    // ── 计算产线汇总数据（用于计划行填充）──────────────────────────
    const lineDailyPlanSum: Record<string, number> = {};
    const lineUpphAvg: Record<string, number[]> = {};
    const lineWhDay: Record<string, number> = {};

    lineRecords.forEach(r => {
      Object.entries(r.dailyPlan).forEach(([d, qty]) => {
        lineDailyPlanSum[d] = (lineDailyPlanSum[d] || 0) + Number(qty);
      });
      if (r.uph) {
        allDates.forEach(d => {
          if (!lineUpphAvg[d]) lineUpphAvg[d] = [];
          lineUpphAvg[d].push(Number(r.uph));
        });
      }
      const detail = typeof r.dailyPlanDetail === 'string'
        ? JSON.parse(r.dailyPlanDetail || '{}')
        : (r.dailyPlanDetail || {});
      Object.entries(detail).forEach(([d, v]: [string, any]) => {
        const bh = Number(v?.baseWorkHours) || 0;
        if (bh > 0) lineWhDay[d] = Math.max(lineWhDay[d] || 0, bh);
      });
    });

    // ── Section Row 3: Plan output-Day shift ──────────────────────
    const planDayRow = sheet.getRow(currentRow++);
    planDayRow.height = 14;
    sheet.mergeCells(`H${currentRow - 1}:J${currentRow - 1}`);
    planDayRow.getCell(8).value = 'Plan output-Day shift';
    planDayRow.getCell(8).font = { ...FONT_BOLD, color: { argb: 'FF1F4E79' } };
    planDayRow.getCell(8).alignment = { horizontal: 'left', vertical: 'middle' };
    for (let c = 1; c <= FIXED_COLS; c++) {
      planDayRow.getCell(c).fill = BG_PLAN_DAY;
      planDayRow.getCell(c).border = BORDER_THIN;
    }
    dateCols.forEach((d, i) => {
      const cell = planDayRow.getCell(DATE_COL_START + i);
      const qty = lineDailyPlanSum[d];
      cell.value = qty != null && qty > 0 ? Math.round(qty) : null;
      cell.numFmt = '#,##0';
      cell.fill = isRestDay(d) ? BG_REST_DAY : BG_PLAN_DAY;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = BORDER_THIN;
      cell.font = FONT_BASE;
    });

    // ── Section Row 4: Plan output-Night shift ─────────────────────
    const planNightRow = sheet.getRow(currentRow++);
    planNightRow.height = 14;
    sheet.mergeCells(`H${currentRow - 1}:J${currentRow - 1}`);
    planNightRow.getCell(8).value = 'Plan output-Night shift';
    planNightRow.getCell(8).font = { ...FONT_BOLD, color: { argb: 'FF833C00' } };
    planNightRow.getCell(8).alignment = { horizontal: 'left', vertical: 'middle' };
    for (let c = 1; c <= FIXED_COLS; c++) {
      planNightRow.getCell(c).fill = BG_PLAN_NIGHT;
      planNightRow.getCell(c).border = BORDER_THIN;
    }
    dateCols.forEach((d, i) => {
      const cell = planNightRow.getCell(DATE_COL_START + i);
      cell.fill = isRestDay(d) ? BG_REST_DAY : BG_PLAN_NIGHT;
      cell.border = BORDER_THIN;
    });

    // ── Section Row 5: UPPH Target ─────────────────────────────────
    const upphRow = sheet.getRow(currentRow++);
    upphRow.height = 14;
    sheet.mergeCells(`H${currentRow - 1}:J${currentRow - 1}`);
    upphRow.getCell(8).value = 'UPPH Target';
    upphRow.getCell(8).font = { ...FONT_BOLD, color: { argb: 'FF375623' } };
    upphRow.getCell(8).alignment = { horizontal: 'left', vertical: 'middle' };
    for (let c = 1; c <= FIXED_COLS; c++) {
      upphRow.getCell(c).fill = BG_UPPH;
      upphRow.getCell(c).border = BORDER_THIN;
    }
    dateCols.forEach((d, i) => {
      const cell = upphRow.getCell(DATE_COL_START + i);
      const uphArr = lineUpphAvg[d];
      const avgUph = uphArr && uphArr.length > 0
        ? uphArr.reduce((a, b) => a + b, 0) / uphArr.length
        : null;
      cell.value = avgUph != null ? Math.round(avgUph * 100) / 100 : null;
      cell.numFmt = '0.00';
      cell.fill = isRestDay(d) ? BG_REST_DAY : BG_UPPH;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = BORDER_THIN;
      cell.font = FONT_BASE;
    });

    // ── Section Row 6: Plan working hours-Day shift ────────────────
    const whDayRow = sheet.getRow(currentRow++);
    whDayRow.height = 14;
    sheet.mergeCells(`H${currentRow - 1}:J${currentRow - 1}`);
    whDayRow.getCell(8).value = 'Plan working hours-Day shift';
    whDayRow.getCell(8).font = { ...FONT_BOLD, color: { argb: 'FF1F4E79' } };
    whDayRow.getCell(8).alignment = { horizontal: 'left', vertical: 'middle' };
    for (let c = 1; c <= FIXED_COLS; c++) {
      whDayRow.getCell(c).fill = BG_WH_DAY;
      whDayRow.getCell(c).border = BORDER_THIN;
    }
    dateCols.forEach((d, i) => {
      const cell = whDayRow.getCell(DATE_COL_START + i);
      const wh = lineWhDay[d];
      cell.value = wh > 0 ? wh : null;
      cell.numFmt = '0.#';
      cell.fill = isRestDay(d) ? BG_REST_DAY : BG_WH_DAY;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = BORDER_THIN;
      cell.font = FONT_BASE;
    });

    // ── Section Row 7: Plan working hours-Night shift ──────────────
    const whNightRow = sheet.getRow(currentRow++);
    whNightRow.height = 14;
    sheet.mergeCells(`H${currentRow - 1}:J${currentRow - 1}`);
    whNightRow.getCell(8).value = 'Plan working hours-Night shift';
    whNightRow.getCell(8).font = { ...FONT_BOLD, color: { argb: 'FF833C00' } };
    whNightRow.getCell(8).alignment = { horizontal: 'left', vertical: 'middle' };
    for (let c = 1; c <= FIXED_COLS; c++) {
      whNightRow.getCell(c).fill = BG_WH_NIGHT;
      whNightRow.getCell(c).border = BORDER_THIN;
    }
    dateCols.forEach((d, i) => {
      const cell = whNightRow.getCell(DATE_COL_START + i);
      cell.fill = isRestDay(d) ? BG_REST_DAY : BG_WH_NIGHT;
      cell.border = BORDER_THIN;
    });

    // ── Section Row 8: MO No 列头 ─────────────────────────────────
    const moHeaderRow = sheet.getRow(currentRow++);
    moHeaderRow.height = 14;
    const moHeaders = ['', '', '', '', '', '', '', 'MO No', 'MO Qty', 'Bal Pro QTY', ''];
    moHeaders.forEach((h, i) => {
      const cell = moHeaderRow.getCell(i + 1);
      cell.value = h || null;
      cell.font = { ...FONT_BOLD, color: { argb: 'FF1F4E79' } };
      cell.fill = BG_MO_HEADER;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = BORDER_THIN;
    });
    dateCols.forEach((d, i) => {
      const cell = moHeaderRow.getCell(DATE_COL_START + i);
      cell.fill = isRestDay(d) ? BG_REST_DAY : BG_MO_HEADER;
      cell.border = BORDER_THIN;
    });

    // ── Section 数据行（订单） ────────────────────────────────────
    lineRecords.forEach((r: any, idx: number) => {
      const dataRow = sheet.getRow(currentRow++);
      dataRow.height = 15;

      // 序号 A
      const cellA = dataRow.getCell(1);
      cellA.value = idx + 1;
      cellA.font = FONT_BASE;
      cellA.fill = BG_WHITE;
      cellA.alignment = { horizontal: 'center', vertical: 'middle' };
      cellA.border = BORDER_THIN;

      // B: Item code
      const cellB = dataRow.getCell(2);
      cellB.value = r.itemId || '';
      cellB.font = FONT_BASE;
      cellB.fill = BG_WHITE;
      cellB.alignment = { horizontal: 'left', vertical: 'middle' };
      cellB.border = BORDER_THIN;

      // C: Project Name
      const cellC = dataRow.getCell(3);
      cellC.value = r.projectName || r.itemId || '';
      cellC.font = FONT_BASE;
      cellC.fill = BG_WHITE;
      cellC.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      cellC.border = BORDER_THIN;

      // D: Customer
      const cellD = dataRow.getCell(4);
      cellD.value = r.customer || '';
      cellD.font = FONT_BASE;
      cellD.fill = BG_WHITE;
      cellD.alignment = { horizontal: 'center', vertical: 'middle' };
      cellD.border = BORDER_THIN;

      // E: STD worker qty (headcount)
      const cellE = dataRow.getCell(5);
      cellE.value = r.headcount || null;
      cellE.font = FONT_BASE;
      cellE.fill = BG_WHITE;
      cellE.alignment = { horizontal: 'center', vertical: 'middle' };
      cellE.border = BORDER_THIN;

      // F: Remark
      const cellF = dataRow.getCell(6);
      cellF.value = r.remark || '';
      cellF.font = FONT_SMALL;
      cellF.fill = BG_WHITE;
      cellF.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      cellF.border = BORDER_THIN;

      // G: Type
      const cellG = dataRow.getCell(7);
      cellG.value = r.type || 'MP';
      cellG.font = FONT_BASE;
      cellG.fill = BG_WHITE;
      cellG.alignment = { horizontal: 'center', vertical: 'middle' };
      cellG.border = BORDER_THIN;

      // H: MO No (prodId)
      const cellH = dataRow.getCell(8);
      cellH.value = r.prodId || '';
      cellH.font = { ...FONT_BASE, color: { argb: 'FF1F4E79' } };
      cellH.fill = BG_WHITE;
      cellH.alignment = { horizontal: 'center', vertical: 'middle' };
      cellH.border = BORDER_THIN;

      // I: MO Qty (totalQty)
      const cellI = dataRow.getCell(9);
      cellI.value = Number(r.totalQty) || null;
      cellI.numFmt = '#,##0';
      cellI.font = FONT_BASE;
      cellI.fill = BG_WHITE;
      cellI.alignment = { horizontal: 'center', vertical: 'middle' };
      cellI.border = BORDER_THIN;

      // J: Bal Pro QTY（用 totalQty 代替，可后续改为余量字段）
      const cellJ = dataRow.getCell(10);
      cellJ.value = Number(r.totalQty) || null;
      cellJ.numFmt = '#,##0';
      cellJ.font = FONT_BASE;
      cellJ.fill = BG_WHITE;
      cellJ.alignment = { horizontal: 'center', vertical: 'middle' };
      cellJ.border = BORDER_THIN;

      // K: 分隔
      dataRow.getCell(11).fill = BG_WHITE;
      dataRow.getCell(11).border = BORDER_THIN;

      // 日期列
      dateCols.forEach((d, i) => {
        const cell = dataRow.getCell(DATE_COL_START + i);
        const inRange = d >= r.startDateStr && d <= r.finishDateStr;
        const qty = r.dailyPlan[d];

        if (!inRange) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
        } else if (qty != null && Number(qty) > 0) {
          cell.value = Math.round(Number(qty));
          cell.numFmt = '#,##0';
          cell.fill = isRestDay(d)
            ? BG_REST_DAY
            : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F0' } };
          cell.font = { ...FONT_BASE, color: { argb: 'FF1F4E79' }, bold: true };
        } else {
          cell.value = 0;
          cell.numFmt = '#,##0';
          cell.fill = isRestDay(d) ? BG_REST_DAY : BG_WHITE;
          cell.font = { ...FONT_SMALL, color: { argb: 'FFBFBFBF' } };
        }
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = BORDER_THIN;
      });
    });

    // ── 空行分隔 Section ─────────────────────────────────────────
    const sepRow = sheet.getRow(currentRow++);
    sepRow.height = 6;
    for (let c = 1; c <= totalCols; c++) {
      sepRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } };
    }
  }

  // ── 12. 冻结首行（让表头固定）────────────────────────────────────
  sheet.views = [{ state: 'frozen', xSplit: FIXED_COLS, ySplit: 6, topLeftCell: `${colLetter(DATE_COL_START)}7` }];

  // ── 13. 输出 Buffer ────────────────────────────────────────────────
  const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `ESG_Production_Plan_${dateTag}.xlsx`;

  ctx.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  ctx.set('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  ctx.set('Cache-Control', 'no-cache, no-store, must-revalidate');

  ctx.body = await workbook.xlsx.writeBuffer();
}
