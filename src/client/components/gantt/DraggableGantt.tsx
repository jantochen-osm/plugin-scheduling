import React, { useRef, useState, useCallback } from 'react';
import { message, Spin, Tag, Typography, Tooltip } from 'antd';
import { dayjs, formatNum } from './utils';

const { Text } = Typography;

// ── Layout constants ────────────────────────────────────────────────────────
const COL_W  = 48;   // px per day column
const ROW_H  = 54;   // px for regular record row
const GRP_H  = 38;   // px for group-header row
const HDR_H  = 46;   // px for sticky date header

const INFO_W = 268;  // px for left fixed info panel

// ── Types ───────────────────────────────────────────────────────────────────
interface DragState {
  id: any;
  startX: number;
  deltaDays: number;
  clampedDeltaDays: number;
  hitBoundary: boolean;
  warnedBoundary: boolean;
}

export interface DraggableGanttProps {
  /**
   * Flat array that may include group-header rows (`isGroupHeader: true`)
   * followed by their child records. Typically produced by flattening
   * the tree structure used in the "按产线树形" Ant-Table.
   */
  records: any[];
  globalDates: string[];                // YYYY-MM-DD sorted ascending
  factoryCalendar: Record<string, any>; // date → calendar row
  api: any;
  onSaved: () => void;
  /** 点击条形（非拖拽）时调用，用于打开调整抽屉 */
  onClickRecord?: (record: any) => void;
}

// ── Helper: greedy capacity fill from a new start date ──────────────────────
async function calcGreedyFill(
  api: any,
  record: any,
  newStartDate: string,
): Promise<{ dailyPlan: Record<string, number>; finishDate: string } | null> {
  const totalQty = Number(record.totalQty) || 0;
  const uph      = Number(record.uph) || 0;

  const estimateDays = uph > 0
    ? Math.min(Math.ceil(totalQty / (uph * 8)) * 2 + 30, 365)
    : 90;
  const queryEnd = dayjs(newStartDate).add(estimateDays, 'day').format('YYYY-MM-DD');

  // Expand query range by 1 day on each side to prevent UTC timestamp timezone
  // shift from excluding the boundary start date (same fix as useCalcDailyPlan).
  const queryStartPadded = dayjs(newStartDate).subtract(1, 'day').format('YYYY-MM-DD');
  const queryEndPadded   = dayjs(queryEnd).add(1, 'day').format('YYYY-MM-DD');

  let workdays: string[] = [];
  let workHoursMap: Record<string, number> = {};
  try {
    const res = await api.request({
      url: 'md_work_calendars:list',
      method: 'get',
      params: {
        paginate: false, pageSize: 500, sort: 'calendarDate',
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
      if (d) { workdays.push(d); workHoursMap[d] = Number(r.workHours) || 10; }
    }
    workdays.sort();
    // Client-side exact filter: trim padded boundary days back to intended range
    workdays = workdays.filter((d) => d >= newStartDate && d <= queryEnd);
  } catch (e: any) {
    message.error('查询工作日历失败：' + (e?.message || ''));
    return null;
  }

  if (workdays.length === 0) {
    message.warning(`${newStartDate} 之后无可排产工作日，请检查工厂日历`);
    return null;
  }

  // ── Query other locked orders on same line overlapping our window ────────
  // Same fixes as useCalcDailyPlan: runId isolation + date range + window-only dates
  const usedByOthers: Record<string, number> = {};
  if (record.chosenLine) {
    try {
      const lockedFilter: any[] = [
        { chosenLine:       { $eq: record.chosenLine } },
        { isManualAdjusted: { $eq: true              } },
        { id:               { $ne: record.id         } },
        { finishDate:       { $gte: newStartDate     } }, // only orders overlapping our window
      ];
      if (record.runId) lockedFilter.push({ runId: { $eq: record.runId } }); // same version only
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
          if (date >= newStartDate && date <= queryEnd) {
            usedByOthers[date] = (usedByOthers[date] || 0) + Number(qty);
          }
        }
      }
    } catch (_) {
      // 查询失败则忽略，退化为不考虑他人占用
    }
  }

  const newDailyPlan: Record<string, number> = {};
  let remaining = totalQty;

  if (uph <= 0) {
    const totalHours = workdays.reduce((s, d) => s + (workHoursMap[d] || 10), 0);
    let allocated = 0;
    workdays.forEach((d, i) => {
      if (i === workdays.length - 1) { newDailyPlan[d] = totalQty - allocated; }
      else {
        const qty = Math.floor(totalQty * ((workHoursMap[d] || 10) / totalHours));
        newDailyPlan[d] = qty; allocated += qty;
      }
    });
  } else {
    for (let i = 0; i < workdays.length; i++) {
      const d            = workdays[i];
      const isLast       = i === workdays.length - 1;
      const fullCap      = Math.floor(uph * (workHoursMap[d] || 10));
      const effectiveCap = Math.max(0, fullCap - (usedByOthers[d] || 0));
      if (remaining <= 0) break;
      if (effectiveCap === 0) continue;                             // 产能被同产线锁定订单占满，跳过
      if (isLast || remaining <= effectiveCap) { newDailyPlan[d] = remaining; remaining = 0; }
      else { newDailyPlan[d] = effectiveCap; remaining -= effectiveCap; }
    }
  }

  const usedDays   = Object.keys(newDailyPlan).filter(d => newDailyPlan[d] > 0).sort();
  const finishDate = usedDays[usedDays.length - 1] || newStartDate;
  return { dailyPlan: newDailyPlan, finishDate };
}

// ── Row height helper ────────────────────────────────────────────────────────
function rowH(record: any) {
  return record.isGroupHeader ? GRP_H : ROW_H;
}

// ============================================================================
// DraggableGantt component
// ============================================================================
export const DraggableGantt: React.FC<DraggableGanttProps> = ({
  records, globalDates, factoryCalendar, api, onSaved, onClickRecord,
}) => {
  const leftRef    = useRef<HTMLDivElement>(null);
  const rightRef   = useRef<HTMLDivElement>(null);
  const dragStartX = useRef<number>(0); // track raw startX for click detection
  const [drag, setDrag]           = useState<DragState | null>(null);
  const [savingIds, setSavingIds] = useState<Set<any>>(new Set());

  // Sync vertical scroll: right → left
  const handleRightScroll = () => {
    if (leftRef.current && rightRef.current) {
      leftRef.current.scrollTop = rightRef.current.scrollTop;
    }
  };

  // Pre-compute cumulative top offset for each row
  const rowTops = records.reduce<number[]>((acc, r, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + rowH(records[i - 1]));
    return acc;
  }, []);
  const totalBodyH = records.reduce((s, r) => s + rowH(r), 0);
  const totalW     = globalDates.length * COL_W;
  const minDate = globalDates[0] ? dayjs(globalDates[0]) : null;
  const maxDate = globalDates[globalDates.length - 1] ? dayjs(globalDates[globalDates.length - 1]) : null;

  // Pre-compute rest-day column indices
  const restDayIndices: number[] = globalDates
    .map((date, idx) => {
      const cal    = factoryCalendar[date];
      const isRest = cal ? !cal.isWorkday : (dayjs(date).day() === 0 || dayjs(date).day() === 6);
      return isRest ? idx : -1;
    })
    .filter(i => i >= 0);

  // ── Drop handler ────────────────────────────────────────────────────────
  const handleDrop = useCallback(async (record: any, deltaDays: number) => {
    if (deltaDays === 0) return;
    const newStartDate = dayjs(record.startDate).add(deltaDays, 'day').format('YYYY-MM-DD');

    if (minDate && maxDate) {
      const newStart = dayjs(newStartDate);
      if (newStart.isBefore(minDate, 'day') || newStart.isAfter(maxDate, 'day')) {
        message.warning('已到时间轴边界，不能继续拖动');
        return;
      }
    }

    setSavingIds(prev => new Set([...prev, record.id]));
    try {
      const result = await calcGreedyFill(api, record, newStartDate);
      if (!result) return;
      const { dailyPlan: newDailyPlan, finishDate: newFinishDate } = result;

      const dailyPlanPatch: Record<string, number> = {};
      Object.keys(record.dailyPlan || {}).forEach(d => { dailyPlanPatch[d] = 0; });
      Object.entries(newDailyPlan).forEach(([d, qty]) => { dailyPlanPatch[d] = qty as number; });

      await api.request({
        url: 'scheduling:adjustResult',
        method: 'post',
        data: {
          id: record.id,
          startDate: newStartDate,
          finishDate: newFinishDate,
          dailyPlanPatch,
          adjustReason: `拖拽排期：${dayjs(record.startDate).format('MM-DD')} → ${dayjs(newStartDate).format('MM-DD')}`,
        },
      });

      message.success(`✅ ${record.prodId} 已移至 ${newStartDate} 开工，完成日 ${newFinishDate}`);
      onSaved();
    } catch (e: any) {
      message.error('保存失败：' + (e?.message || ''));
    } finally {
      setSavingIds(prev => { const n = new Set(prev); n.delete(record.id); return n; });
    }
  }, [api, maxDate, minDate, onSaved]);

  // ── Pointer event handlers ───────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>, record: any) => {
    if (savingIds.has(record.id)) return;
    e.preventDefault();
    dragStartX.current = e.clientX;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setDrag({ id: record.id, startX: e.clientX, deltaDays: 0, clampedDeltaDays: 0, hitBoundary: false, warnedBoundary: false });
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>, record: any) => {
    if (!drag || drag.id !== record.id) return;
    const rawDelta = Math.round((e.clientX - drag.startX) / COL_W);
    const startIdx = globalDates.indexOf(dayjs(record.startDate).format('YYYY-MM-DD'));
    const endIdx   = globalDates.indexOf(dayjs(record.finishDate).format('YYYY-MM-DD'));
    if (startIdx < 0 || endIdx < 0) return;

    const minDelta = -startIdx;
    const maxDelta = globalDates.length - 1 - endIdx;
    const clampedDelta = Math.max(minDelta, Math.min(maxDelta, rawDelta));
    const hitBoundary = rawDelta !== clampedDelta;

    if (clampedDelta !== drag.clampedDeltaDays || hitBoundary !== drag.hitBoundary || rawDelta !== drag.deltaDays) {
      setDrag(prev => prev ? {
        ...prev,
        deltaDays: rawDelta,
        clampedDeltaDays: clampedDelta,
        hitBoundary,
      } : null);
    }

    if (hitBoundary && !drag.warnedBoundary) {
      setDrag(prev => prev ? { ...prev, warnedBoundary: true } : null);
      message.warning('已到时间轴边界，不能继续拖动');
    }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>, record: any) => {
    if (!drag || drag.id !== record.id) return;
    const finalDelta = drag.clampedDeltaDays;
    const totalMove  = Math.abs(e.clientX - dragStartX.current);
    setDrag(null);
    if (totalMove < 5) {
      // Treat as click → open adjustment drawer
      onClickRecord?.(record);
    } else if (finalDelta !== 0) {
      handleDrop(record, finalDelta);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: 'flex',
      height: 650,
      border: '1px solid #e8e8e8',
      borderRadius: 8,
      overflow: 'hidden',
      background: '#fff',
    }}>

      {/* ── LEFT INFO PANEL ─────────────────────────────────────────────── */}
      <div style={{
        width: INFO_W, flexShrink: 0,
        borderRight: '2px solid #e4e8ef',
        display: 'flex', flexDirection: 'column',
        background: '#fff', zIndex: 10,
        boxShadow: '2px 0 6px rgba(0,0,0,0.06)',
      }}>
        {/* Header */}
        <div style={{
          height: HDR_H, flexShrink: 0,
          background: 'linear-gradient(to bottom, #f8f9fb, #f0f2f5)',
          borderBottom: '2px solid #e4e8ef',
          display: 'flex', alignItems: 'center', padding: '0 14px',
        }}>
          <Text strong style={{ fontSize: 12, color: '#595959' }}>产线 / 生产单号 / 物料</Text>
        </div>

        {/* Rows (overflowY hidden — JS-driven scroll) */}
        <div ref={leftRef} style={{ flex: 1, overflowY: 'hidden' }}>
          {records.map((record) => {
            const isSaving = savingIds.has(record.id);

            // ── Group header row ──
            if (record.isGroupHeader) {
              return (
                <div key={record.id} style={{
                  height: GRP_H,
                  borderBottom: '2px solid #d9e8ff',
                  padding: '0 12px',
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: 'linear-gradient(to right, #e6f4ff, #f0f7ff)',
                }}>
                  <Text strong style={{ fontSize: 13, color: '#1677ff' }}>
                    {record.chosenLine}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {Number(record.totalQty || 0).toLocaleString()} pcs
                  </Text>
                </div>
              );
            }

            // ── Regular record row ──
            return (
              <div key={record.id} style={{
                height: ROW_H,
                borderBottom: '1px solid #f0f0f0',
                padding: '4px 12px',
                display: 'flex', flexDirection: 'column', justifyContent: 'center',
                background: record.isManualAdjusted ? '#fffbe6' : '#fff',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {isSaving && <Spin size="small" style={{ marginRight: 2 }} />}
                  <Text strong style={{
                    fontSize: 12,
                    maxWidth: 148,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    color: record.isOverdue ? '#cf1322' : 'inherit',
                  }}>
                    {record.prodId}
                  </Text>
                  {record.isOverdue && (
                    <Tag color="error" style={{ fontSize: 9, padding: '0 3px', margin: 0, lineHeight: '14px' }}>逾期</Tag>
                  )}
                  {record.isManualAdjusted && (
                    <Tag color="warning" style={{ fontSize: 9, padding: '0 3px', margin: 0, lineHeight: '14px' }}>✎锁</Tag>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 2 }}>
                  <Text type="secondary" style={{
                    fontSize: 10, maxWidth: 100,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {record.itemId}
                  </Text>
                  {record.dlvDate && (
                    <Text type="warning" style={{ fontSize: 10 }}>
                      🚚{dayjs(record.dlvDate).format('MM/DD')}
                    </Text>
                  )}
                </div>
                <Text type="secondary" style={{ fontSize: 10, marginTop: 1 }}>
                  {Number(record.totalQty || 0).toLocaleString()} pcs
                  {record.uph > 0 && ` · UPH ${formatNum(record.uph, 1)}`} 
                   · Labor {record.headcount || 'N/A'}
                </Text>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── RIGHT SCROLLABLE GANTT AREA ─────────────────────────────────── */}
      <div
        ref={rightRef}
        style={{ flex: 1, overflow: 'auto', position: 'relative' }}
        onScroll={handleRightScroll}
      >
        <div style={{ minWidth: totalW, height: HDR_H + totalBodyH, position: 'relative' }}>

          {/* ── DATE HEADER (sticky top) ──────────────────────────────── */}
          <div style={{
            position: 'sticky', top: 0, zIndex: 20, height: HDR_H,
            display: 'flex',
            background: 'linear-gradient(to bottom, #f8f9fb, #f0f2f5)',
            borderBottom: '2px solid #e4e8ef',
          }}>
            {globalDates.map((date, idx) => {
              const isRest = restDayIndices.includes(idx);
              const dow    = ['日','一','二','三','四','五','六'][dayjs(date).day()];
              return (
                <div key={date} style={{
                  width: COL_W, flexShrink: 0, textAlign: 'center',
                  borderRight: '1px solid #efefef',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  background: isRest ? 'rgba(245,245,245,0.8)' : 'transparent',
                }}>
                  <span style={{ fontSize: 9, color: '#8c8c8c', lineHeight: 1.2 }}>{dayjs(date).format('MM/DD')}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: isRest ? '#ff4d4f' : '#595959', lineHeight: 1.4 }}>{dow}</span>
                </div>
              );
            })}
          </div>

          {/* ── GRID COLUMN LINES ─────────────────────────────────────── */}
          <div style={{
            position: 'absolute', top: HDR_H, left: 0,
            width: totalW, height: totalBodyH,
            backgroundImage: `repeating-linear-gradient(to right, transparent 0px, transparent ${COL_W - 1}px, #efefef ${COL_W - 1}px, #efefef ${COL_W}px)`,
            zIndex: 0, pointerEvents: 'none',
          }} />

          {/* ── REST DAY COLUMN SHADING ───────────────────────────────── */}
          {restDayIndices.map(idx => (
            <div key={`rest-${idx}`} style={{
              position: 'absolute',
              top: HDR_H, left: idx * COL_W,
              width: COL_W, height: totalBodyH,
              background: 'rgba(245,245,245,0.7)',
              zIndex: 1, pointerEvents: 'none',
            }} />
          ))}

          {/* ── ROW BACKGROUNDS (groups + alternating) ───────────────── */}
          {records.map((record, i) => {
            const top = HDR_H + rowTops[i];
            const h   = rowH(record);

            if (record.isGroupHeader) {
              return (
                <div key={`grp-bg-${record.id}`} style={{
                  position: 'absolute', top, left: 0,
                  width: totalW, height: h,
                  background: 'linear-gradient(to right, rgba(22,119,255,0.07), rgba(22,119,255,0.02))',
                  borderBottom: '2px solid #d9e8ff',
                  zIndex: 3, pointerEvents: 'none',
                  display: 'flex', alignItems: 'center', paddingLeft: 8,
                }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#1677ff', opacity: 0.5, letterSpacing: 1 }}>
                    {record.chosenLine}
                  </span>
                </div>
              );
            }

            return (
              <div key={`row-bg-${record.id}`} style={{
                position: 'absolute', top, left: 0,
                width: totalW, height: h,
                borderBottom: '1px solid #f0f0f0',
                background: record.isManualAdjusted ? 'rgba(250,219,20,0.04)' : 'transparent',
                zIndex: 2, pointerEvents: 'none',
              }} />
            );
          })}

          {/* ── DRAGGABLE BARS (leaf records only) ───────────────────── */}
          {records.map((record, rowIdx) => {
            if (record.isGroupHeader) return null;

            const startStr  = record.startDate  ? dayjs(record.startDate).format('YYYY-MM-DD')  : null;
            const finishStr = record.finishDate ? dayjs(record.finishDate).format('YYYY-MM-DD') : null;
            if (!startStr || !finishStr) return null;

            const startIdx = globalDates.indexOf(startStr);
            const endIdx   = globalDates.indexOf(finishStr);
            if (startIdx < 0 || endIdx < 0) return null;

            const isDragging   = drag?.id === record.id;
            const rawDelta     = isDragging ? (drag?.deltaDays || 0) : 0;
            const clamped      = isDragging ? (drag?.clampedDeltaDays ?? 0) : 0;
            const hitBoundary  = isDragging ? Boolean(drag?.hitBoundary) : false;

            const rowTop    = HDR_H + rowTops[rowIdx];
            const barLeft   = (startIdx + clamped) * COL_W + 3;
            const barWidth  = Math.max((endIdx - startIdx + 1) * COL_W - 6, 24);
            const barTop    = rowTop + 3;
            const barHeight = ROW_H - 6;  // 48px: top ~16px info + bottom 28px (text+mini-bars) + padding

            const isSaving = savingIds.has(record.id);
            let barColor = '#1677ff';
            if (record.isOverdue)        barColor = '#f5222d';
            if (record.isManualAdjusted) barColor = '#fa8c16';

            const tooltipLabel = isDragging && clamped !== 0
              ? `新开工：${dayjs(record.startDate).add(clamped, 'day').format('MM-DD')}`
              : `${startStr} ~ ${finishStr}`;

            return (
              <Tooltip
                key={`bar-${record.id}`}
                title={tooltipLabel}
                open={isDragging ? true : undefined}
                placement="top"
                zIndex={100}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: barLeft, top: barTop,
                    width: barWidth, height: barHeight,
                    background: isSaving
                      ? '#d9d9d9'
                      : isDragging
                        ? barColor
                        : barColor + 'cc',
                    border: `1.5px solid ${isDragging ? barColor : barColor + '60'}`,
                    borderRadius: 6,
                    cursor: isSaving ? 'wait' : (isDragging ? 'grabbing' : 'grab'),
                    zIndex: isDragging ? 30 : 5,
                    boxShadow: isDragging
                      ? hitBoundary
                        ? `0 8px 24px rgba(0,0,0,0.18), 0 0 0 2px #ff4d4f66`
                        : `0 8px 24px rgba(0,0,0,0.18), 0 0 0 2px ${barColor}40`
                      : '0 1px 4px rgba(0,0,0,0.10)',
                    transform: isDragging ? 'scaleY(1.04)' : 'none',
                    transition: isDragging ? 'box-shadow 0.1s' : 'box-shadow 0.15s, transform 0.1s',
                    overflow: 'hidden',
                    display: 'flex', flexDirection: 'column',
                    padding: 0, gap: 0,
                    userSelect: 'none', touchAction: 'none',
                    willChange: 'left, box-shadow',
                  }}
                  onPointerDown={(e) => onPointerDown(e, record)}
                  onPointerMove={(e) => onPointerMove(e, record)}
                  onPointerUp={(e) => onPointerUp(e, record)}
                  onPointerCancel={() => setDrag(null)}
                >
                  {isSaving ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                      <Spin size="small" />
                    </div>
                  ) : (
                    <>
                      {/* Left accent stripe */}
                      <div style={{
                        position: 'absolute', left: 0, top: 0,
                        width: 3, height: '100%',
                        background: barColor, borderRadius: '6px 0 0 6px',
                      }} />
                      {isDragging && hitBoundary && (
                        <div style={{
                          position: 'absolute', inset: 0,
                          border: '1px dashed #ff4d4f',
                          borderRadius: 6,
                          pointerEvents: 'none',
                        }} />
                      )}

                      {/* 上部：订单信息 */}
                      <div style={{
                        display: 'flex', alignItems: 'center',
                        padding: '3px 8px 0 10px', gap: 6, flex: 1, minHeight: 0,
                      }}>
                        {/* <span style={{
                          fontSize: 11, fontWeight: 700,
                          color: 'white', whiteSpace: 'nowrap',
                          overflow: 'hidden', textOverflow: 'ellipsis',
                          maxWidth: barWidth - 80,
                          textShadow: '0 1px 2px rgba(0,0,0,0.25)',
                        }}>
                          {record.prodId}
                        </span> */}
                        <span style={{
                          fontSize: 10, color: 'rgba(255,255,255,0.88)',
                          whiteSpace: 'nowrap', flexShrink: 0,
                          textShadow: '0 1px 2px rgba(0,0,0,0.2)',
                        }}>
                          {Number(record.totalQty || 0).toLocaleString()}pcs
                        </span>
                      </div>

                      {/* 下部：每日产能小柱图（含数字标签） */}
                      <div style={{
                        position: 'relative', height: 28, flexShrink: 0,
                        margin: '0 3px 2px',
                      }}>
                        {globalDates.slice(startIdx, endIdx + 1).flatMap((date, i) => {
                          const qty    = Number((record.dailyPlan || {})[date] || 0);
                          if (qty === 0) return [];
                          const detail = (record.dailyPlanDetail || {})[date];
                          // 利用实际工时 vs 标准工时计算利用率
                          const usedH  = Number(detail?.effectiveHours || 0)
                                       + Number(detail?.overtimeHours  || 0)
                                       + Number(detail?.setupHours     || 0);
                          const stdH   = Number(detail?.baseWorkHours  || 10);
                          const isOT   = usedH > 0 && usedH > stdH * 1.02;
                          // 无 detail 时，用产量 / 满产容量估算
                          const stdCap = Number(record.uph || 0) * stdH || 1;
                          const ratio  = usedH > 0
                            ? Math.min(usedH / stdH, 1)
                            : Math.min(qty / stdCap, 1);
                          const TRACK_H = 14; // 满产高度基准
                          const miniH  = Math.max(2, Math.round(ratio * TRACK_H));
                          const label  = qty >= 10000
                            ? `${Math.round(qty / 1000)}k`
                            : String(qty);
                          return [
                            // 满产轨道（背景参照线）
                            <div
                              key={`track-${date}`}
                              style={{
                                position: 'absolute',
                                left: i * COL_W + 1, bottom: 0,
                                width: COL_W - 2, height: TRACK_H,
                                background: 'rgba(255,255,255,0.18)',
                                borderRadius: '2px 2px 0 0',
                                pointerEvents: 'none',
                              }}
                            />,
                            // 实际产量填充（在轨道上叠加）
                            <div
                              key={`bar-${date}`}
                              title={`${dayjs(date).format('MM/DD')}: ${qty.toLocaleString()} pcs${isOT ? ' ★加班' : ''}`}
                              style={{
                                position: 'absolute',
                                left: i * COL_W + 1, bottom: 0,
                                width: COL_W - 2, height: miniH,
                                background: isOT
                                  ? 'rgba(220,50,50,0.88)'  // 红=加班
                                  : 'rgba(255,255,255,0.72)',
                                borderRadius: '2px 2px 0 0',
                                pointerEvents: 'none',
                              }}
                            />,
                            // 数字标签：固定在轨道顶部上方，不随实际高度移动
                            <span
                              key={`lbl-${date}`}
                              style={{
                                position: 'absolute',
                                bottom: TRACK_H + 1,
                                left: i * COL_W + 1,
                                width: COL_W - 2,
                                textAlign: 'center',
                                fontSize: 8,
                                lineHeight: '10px',
                                color: '#fff',
                                fontWeight: isOT ? 700 : 400,
                                pointerEvents: 'none',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                              }}
                            >
                              {label}
                            </span>,
                          ];
                        })}
                      </div>
                    </>
                  )}
                </div>
              </Tooltip>
            );
          })}

        </div>
      </div>
    </div>
  );
};
