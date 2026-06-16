import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Table, Tag, Typography, Space, message, Button, Radio,
  Popover, Tooltip, Popconfirm, Alert, Modal, DatePicker,
} from 'antd';
import { dayjs, formatNum } from './gantt/utils';
import { CapacityDetailCard } from './gantt/CapacityDetailCard';
import { AdjustDrawer } from './gantt/AdjustDrawer';
import { DraggableGantt } from './gantt/DraggableGantt';

const { Text, Title } = Typography;

// ============================================================================
// 主组件：排产甘特图
// ============================================================================
interface SchedulingGanttProps {
  api: any;
  runId?: string; // 不传 = 自动加载最新版本
}

const SchedulingGantt: React.FC<SchedulingGanttProps> = ({ api, runId }) => {
  const [rawRecords,     setRawRecords]     = useState<any[]>([]);
  const [loading,        setLoading]        = useState(false);
  const [viewMode]      = useState<'grouped' | 'flat'>('grouped');
  const [factoryCalendar, setFactoryCalendar] = useState<Record<string, any>>({});
  const [currentRunId,   setCurrentRunId]   = useState<string | undefined>(runId);

  const [drawerOpen,     setDrawerOpen]     = useState(false);
  const [drawerRecord,   setDrawerRecord]   = useState<any>(null);
  const [reScheduling,   setReScheduling]   = useState(false);
  const [unlockRescheduleOpen, setUnlockRescheduleOpen] = useState(false);
  const [unlockRescheduleStartDate, setUnlockRescheduleStartDate] = useState<any>(dayjs());

  /** 已锁定条数（直接从 rawRecords 计算，无需额外请求）*/
  const adjustedCount = useMemo(
    () => rawRecords.filter((r: any) => r.isManualAdjusted).length,
    [rawRecords],
  );

  const openDrawer  = useCallback((record: any) => { setDrawerRecord(record); setDrawerOpen(true); }, []);
  const closeDrawer = useCallback(() => { setDrawerOpen(false); setDrawerRecord(null); }, []);

  // ── 拉取排产数据 & 工厂日历 ───────────────────────────────────────────────
  const fetchScheduleData = useCallback(async () => {
    setLoading(true);
    try {
      // 版本管理：确定有效 runId
      let effectiveRunId = runId;
      if (!effectiveRunId) {
        // 未传入 runId（独立页面模式），查询最新版本
        try {
          const lastRunRes = await api.request({ url: 'scheduling:lastRun', method: 'get' });
          effectiveRunId = lastRunRes?.data?.data?.data?.runId
                        || lastRunRes?.data?.data?.runId
                        || lastRunRes?.data?.runId;
        } catch {
          // lastRun 失败时不过滤，返回全量（兴容旧数据）
        }
      }
      setCurrentRunId(effectiveRunId);

      const filterParam = effectiveRunId
        ? { filter: JSON.stringify({ runId: { $eq: effectiveRunId } }) }
        : {};

      const response = await api.request({
        url: 'schedule_results_v2:list',
        method: 'get',
        params: { paginate: false, pageSize: 1000, sort: 'startDate', ...filterParam },
      });

      const records = response?.data?.data || response?.data || [];

      let minGlobalDate: any = null;
      let maxGlobalDate: any = null;

      const processedRecords = records.map((record: any) => {
        const dailyPlan = typeof record.dailyPlan === 'string'
          ? JSON.parse(record.dailyPlan || '{}')
          : (record.dailyPlan || {});
        const dailyPlanDetail = typeof record.dailyPlanDetail === 'string'
          ? JSON.parse(record.dailyPlanDetail || '{}')
          : (record.dailyPlanDetail || {});

        // 计算回退满产能力（用于甘特格高度比例）
        let maxBaseHours = 10;
        const hoursArray = Object.values(dailyPlanDetail).map((d: any) => Number(d.baseWorkHours) || 0);
        if (hoursArray.length > 0 && Math.max(...hoursArray) > 0) {
          maxBaseHours = Math.max(...hoursArray);
        }
        let fallbackStandardCapacity = (Number(record.uph) || 0) * maxBaseHours;
        if (fallbackStandardCapacity <= 0) {
          fallbackStandardCapacity = Math.max(1, ...Object.values(dailyPlan).map((v: any) => Number(v) || 0));
        }

        if (record.startDate) {
          const s = dayjs(record.startDate);
          if (!minGlobalDate || s.isBefore(minGlobalDate)) minGlobalDate = s;
        }
        if (record.finishDate) {
          const f = dayjs(record.finishDate);
          if (!maxGlobalDate || f.isAfter(maxGlobalDate)) maxGlobalDate = f;
        }

        return {
          ...record,
          id: record.id || `record_${Math.random().toString(36).substring(2, 9)}`,
          dailyPlan,
          dailyPlanDetail,
          fallbackStandardCapacity,
        };
      });

      setRawRecords(processedRecords);

      // 拉取工厂日历（用于甘特格休息日着色）
      if (minGlobalDate && maxGlobalDate) {
        const calResponse = await api.request({
          url: 'md_work_calendars:list',
          method: 'get',
          params: {
            paginate: false, pageSize: 500,
            filter: JSON.stringify({
              calendarDate: {
                $gte: minGlobalDate.format('YYYY-MM-DD'),
                $lte: maxGlobalDate.format('YYYY-MM-DD'),
              },
            }),
          },
        });
        const calRecords = calResponse?.data?.data || calResponse?.data || [];
        const calMap: Record<string, any> = {};
        calRecords.forEach((cal: any) => {
          if (cal.calendarDate) calMap[cal.calendarDate] = cal;
        });
        setFactoryCalendar(calMap);
      }

      if (processedRecords.length > 0) message.success('排产数据及日历矩阵已更新');
    } catch (error) {
      console.error('NocoBase Error:', error);
      message.error('数据拉取失败，请检查网络。');
    } finally {
      setLoading(false);
    }
  }, [api]);

  /** 调整后重算 */
  const handleReSchedule = useCallback(async () => {
    setReScheduling(true);
    try {
      // Derive the version's earliest startDate from current records so the
      // scheduler starts non-pinned orders from the right date instead of
      // defaulting to today (which would waste capacity between the version
      // start and today).
      const versionStartDate = rawRecords
        .map((r: any) => (r.startDate ? dayjs(r.startDate).format('YYYY-MM-DD') : ''))
        .filter(Boolean)
        .sort()[0];

      const result = await api.request({
        url: 'scheduling:reScheduleAfterAdjust',
        method: 'post',
        data: { strategy: 'ESG', runId: currentRunId, startDate: versionStartDate },
      });
      const data = result?.data;
      message.success(
        `重算完成：保留锁定 ${data?.pinnedCount ?? 0} 单，重排 ${data?.reScheduledCount ?? 0} 单`,
      );
      fetchScheduleData();
    } catch (e: any) {
      message.error('重算失败：' + (e?.message || '未知错误'));
    } finally {
      setReScheduling(false);
    }
  }, [api, currentRunId, fetchScheduleData, rawRecords]);

  const handleUnlockAllAndReschedule = useCallback(async () => {
    setReScheduling(true);
    try {
      if (!currentRunId) {
        throw new Error('当前版本号不存在，无法执行版本内重排');
      }

      const unlockRes = await api.request({
        url: 'scheduling:unlockAllByRunId',
        method: 'post',
        data: { runId: currentRunId },
      });
      const unlockedCount = unlockRes?.data?.unlockedCount ?? 0;

      const result = await api.request({
        url: 'scheduling:reScheduleAfterAdjust',
        method: 'post',
        data: {
          strategy: 'ESG',
          runId: currentRunId,
          startDate: unlockRescheduleStartDate?.format('YYYY-MM-DD'),
        },
      });
      const data = result?.data || {};
      message.success(
        `已完成版本内重排：版本 ${currentRunId}，解锁 ${unlockedCount} 条，开工日期 ${unlockRescheduleStartDate?.format('YYYY-MM-DD') || '今日'}，重排 ${data?.reScheduledCount ?? 0} 条`,
      );
      fetchScheduleData();
    } catch (e: any) {  
      message.error('版本内重排失败：' + (e?.message || ''));
    } finally {
      setReScheduling(false);
      setUnlockRescheduleOpen(false);
    }
  }, [api, currentRunId, fetchScheduleData, unlockRescheduleStartDate]);

  // 初始加载
  useEffect(() => { fetchScheduleData(); }, []);

  // 监听排产完成事件，自动刷新（与 SchedulingOrderSelector 通信）
  useEffect(() => {
    const handler = () => {
      message.info('检测到新排产结果，正在刷新甘特图…');
      fetchScheduleData();
    };
    window.addEventListener('scheduling:refresh', handler);
    return () => window.removeEventListener('scheduling:refresh', handler);
  }, [fetchScheduleData]);

  // ── 表格数据（按产线树形 or 平铺）────────────────────────────────────────
  const tableData = useMemo(() => {
    if (viewMode === 'flat') return rawRecords;

    const lineMap: Record<string, any> = {};
    rawRecords.forEach((record) => {
      const line = record.chosenLine || '未分配产线';
      if (!lineMap[line]) {
        lineMap[line] = {
          id: `group_${line}`, prodId: `【产线汇总】 ${line}`, chosenLine: line,
          isGroupHeader: true, totalQty: 0,
          dailyPlan: {} as Record<string, number>,
          dailyTotalTime: {} as Record<string, number>,
          dailyBaseTime:  {} as Record<string, number>,
          children: [], startDate: record.startDate, finishDate: record.finishDate,
        };
      }
      const group = lineMap[line];
      group.children.push(record);
      group.totalQty += Number(record.totalQty || 0);
      if (dayjs(record.startDate).isBefore(dayjs(group.startDate))) group.startDate = record.startDate;
      if (dayjs(record.finishDate).isAfter(dayjs(group.finishDate)))  group.finishDate = record.finishDate;

      Object.entries(record.dailyPlan).forEach(([date, qty]) => {
        group.dailyPlan[date] = (group.dailyPlan[date] || 0) + Number(qty);
        const detail = record.dailyPlanDetail?.[date];
        if (detail) {
          const tTime = (Number(detail.effectiveHours) || 0) + (Number(detail.overtimeHours) || 0) + (Number(detail.setupHours) || 0);
          group.dailyTotalTime[date] = (group.dailyTotalTime[date] || 0) + tTime;
          group.dailyBaseTime[date]  = Math.max(group.dailyBaseTime[date] || 0, Number(detail.baseWorkHours) || 10);
        }
      });
    });

    Object.values(lineMap).forEach((group: any) => {
      group.maxQty = Math.max(1, ...Object.values(group.dailyPlan).map((v: any) => Number(v) || 0));
    });

    return Object.values(lineMap).sort((a: any, b: any) => a.chosenLine.localeCompare(b.chosenLine));
  }, [rawRecords, viewMode]);

  // ── 展开为平铺数组（供 DraggableGantt 使用）： group header + 它的 children 交替列出
  const flatGroupedData = useMemo(() => {
    const result: any[] = [];
    (tableData as any[]).forEach((group: any) => {
      result.push(group);
      if (group.children) group.children.forEach((child: any) => result.push(child));
    });
    return result;
  }, [tableData]);

  // ── 全局日期轴（所有记录 startDate~finishDate 并集）──────────────────────
  const globalDates = useMemo(() => {
    if (!rawRecords || rawRecords.length === 0) return [];
    let minDate: any = null, maxDate: any = null;
    rawRecords.forEach((r: any) => {
      if (!r.startDate || !r.finishDate) return;
      const s = dayjs(r.startDate), f = dayjs(r.finishDate);
      if (!minDate || s.isBefore(minDate)) minDate = s;
      if (!maxDate || f.isAfter(maxDate))  maxDate  = f;
    });
    if (!minDate || !maxDate) return [];
    const dates: string[] = [];
    let cur = minDate.clone();
    while (cur.isBefore(maxDate) || cur.isSame(maxDate, 'day')) {
      dates.push(cur.format('YYYY-MM-DD'));
      cur = cur.add(1, 'day');
    }
    return dates;
  }, [rawRecords]);

  // ── 动态日期列 ─────────────────────────────────────────────────────────────
  const dynamicDateColumns = useMemo(() => {
    if (!globalDates || globalDates.length === 0) return [];

    const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return globalDates.map(date => {
      const cellDate      = dayjs(date);
      const dayOfWeek     = WEEKDAYS_EN[cellDate.day()];
      const isRestDayHeader = factoryCalendar[date]
        ? !factoryCalendar[date].isWorkday
        : (cellDate.day() === 0 || cellDate.day() === 6);

      return {
        title: (
          <div style={{ textAlign: 'center', lineHeight: '1.2' }}>
            <div style={{ fontSize: '10px', color: '#8c8c8c' }}>{cellDate.format('MM/DD')}</div>
            <div style={{ fontSize: '11px', fontWeight: 'bold', color: isRestDayHeader ? '#ff4d4f' : 'inherit' }}>
              {dayOfWeek}
            </div>
          </div>
        ),
        dataIndex: ['dailyPlan', date],
        key: date,
        align: 'center' as const,
        width: 48,
        onCell: () => ({ style: { padding: 0 } }),
        render: (val: any, record: any) => {
          const startDate  = dayjs(record.startDate).format('YYYY-MM-DD');
          const finishDate = dayjs(record.finishDate).format('YYYY-MM-DD');
          const inRange    = date >= startDate && date <= finishDate;
          const hasData    = val !== undefined && val !== null;
          const qty        = Number(val) || 0;

          let isRestDayBackground = false;
          if (factoryCalendar[date]) {
            isRestDayBackground = !factoryCalendar[date].isWorkday;
          } else {
            isRestDayBackground = cellDate.day() === 0 || cellDate.day() === 6;
          }

          const baseStyle: React.CSSProperties = {
            width: '100%', height: '100%', minHeight: '38px',
            display: 'flex', justifyContent: 'center', position: 'relative',
            boxSizing: 'border-box', paddingBottom: '2px',
          };

          // 非生产周期：斜纹底
          if (!inRange) {
            return (
              <div style={{
                ...baseStyle, backgroundColor: '#f5f5f5',
                backgroundImage: 'repeating-linear-gradient(-45deg, transparent, transparent 4px, rgba(0,0,0,0.04) 4px, rgba(0,0,0,0.04) 8px)',
                alignItems: 'center',
              }} title="非生产周期">
                <span style={{ color: 'rgba(0,0,0,0.15)', fontSize: '12px' }}>-</span>
              </div>
            );
          }

          const restStyle = isRestDayBackground
            ? { backgroundColor: '#f0f0f0', borderLeft: '1px solid #e8e8e8', borderRight: '1px solid #e8e8e8' }
            : { backgroundColor: '#ffffff' };

          let CellContent: React.ReactNode;

          if (!hasData) {
            CellContent = <div style={{ ...baseStyle, ...restStyle, borderBottom: '2px solid #e8e8e8' }} />;
          } else if (qty === 0) {
            CellContent = (
              <div style={{ ...baseStyle, ...restStyle, borderBottom: '2px solid #e8e8e8', alignItems: 'flex-end' }}>
                <span style={{ color: 'rgba(0,0,0,0.25)', fontSize: '11px', fontWeight: 'bold' }}>0</span>
              </div>
            );
          } else {
            // 计算产能使用比例（用于甘特条高度）
            let capacityRatio = 0;
            if (record.isGroupHeader) {
              const tTime = record.dailyTotalTime?.[date] || 0;
              const bTime = record.dailyBaseTime?.[date]  || 10;
              capacityRatio = tTime > 0 ? tTime / bTime : qty / (record.maxQty || 1);
            } else {
              const detail = record.dailyPlanDetail?.[date];
              if (detail) {
                const tTime = (Number(detail.effectiveHours) || 0) + (Number(detail.overtimeHours) || 0) + (Number(detail.setupHours) || 0);
                const bTime = Number(detail.baseWorkHours) || 10;
                capacityRatio = tTime > 0 ? tTime / bTime : qty / (record.fallbackStandardCapacity || 1);
              } else {
                capacityRatio = qty / (record.fallbackStandardCapacity || 1);
              }
            }

            const isOverload    = capacityRatio > 1.05;
            const heightPercent = Math.min(Math.max(capacityRatio * 100, 10), 100);
            let barColor = record.isGroupHeader ? '#52c41a' : '#1677ff';
            if (isOverload) barColor = '#fa8c16';

            CellContent = (
              <div style={{ ...baseStyle, ...restStyle, alignItems: 'flex-end' }}>
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, width: '100%',
                  height: `${heightPercent}%`, backgroundColor: barColor,
                  opacity: isOverload ? 0.4 : 0.25, transition: 'all 0.3s ease',
                }} />
                <div style={{
                  position: 'relative', zIndex: 1, fontSize: '11px', fontWeight: 'bold', color: barColor,
                  borderBottom: record.isGroupHeader ? 'none' : '1px dashed #91caff',
                  cursor: record.isGroupHeader ? 'default' : 'pointer',
                }}>
                  {formatNum(qty)}
                </div>
              </div>
            );
          }

          // 分组行无 Popover
          if (record.isGroupHeader) return CellContent;

          const dayDetail = record.dailyPlanDetail ? record.dailyPlanDetail[date] : null;
          return (
            <Popover
              content={<CapacityDetailCard date={date} detail={dayDetail} isGlobalRest={isRestDayBackground} />}
              title={null} trigger="hover" placement="left" mouseEnterDelay={0.3}
              overlayInnerStyle={{
                padding: '16px 20px', borderRadius: '12px',
                boxShadow: '0 6px 16px -8px rgba(0,0,0,0.08), 0 9px 28px 0 rgba(0,0,0,0.05), 0 12px 48px 16px rgba(0,0,0,0.03)',
              }}
            >
              {CellContent}
            </Popover>
          );
        },
      };
    });
  }, [rawRecords, factoryCalendar]);

  // ── 固定基础列 ─────────────────────────────────────────────────────────────
  const baseColumns = [
    {
      title: '生产单号 / 产线汇总', dataIndex: 'prodId', key: 'prodId', fixed: 'left' as const, width: 200,
      render: (text: string, record: any) => {
        if (record.isGroupHeader) return <Text strong style={{ fontSize: '13px' }}>{text}</Text>;
        return (
          <Space size={4} align="center">
            <Space direction="vertical" size={0}>
              <Text strong>{text}</Text>
              {record.isOverdue && <Tag color="red" style={{ margin: 0, fontSize: '10px' }}>逾期</Tag>}
            </Space>
            {record.isManualAdjusted && (
              <Tooltip
                title={
                  <div style={{ fontSize: 12 }}>
                    {record.adjustReason && <div>备注：{record.adjustReason}</div>}
                    {record.pinnedBy     && <div>调整人：{record.pinnedBy}</div>}
                    {record.adjustedAt   && <div>时间：{new Date(record.adjustedAt).toLocaleString('zh-CN')}</div>}
                  </div>
                }
              >
                <Tag color="orange" style={{ fontSize: 10, padding: '0 4px', cursor: 'default' }}>✎ 已调整</Tag>
              </Tooltip>
            )}
            <Tooltip title="调整此排产结果">
              <Button
                type="link" size="small"
                style={{ padding: '0 2px', color: '#1677ff', fontSize: 14 }}
                onClick={(e) => { e.stopPropagation(); openDrawer(record); }}
              >✎</Button>
            </Tooltip>
          </Space>
        );
      },
    },
    {
      title: '交期', dataIndex: 'dlvDate', key: 'dlvDate', fixed: 'left' as const, width: 90,
      render: (val: any, record: any) =>
        record.isGroupHeader ? '-' : (val ? <Text strong type="warning">{dayjs(val).format('MM-DD')}</Text> : '-'),
    },
    {
      title: '物料', dataIndex: 'itemId', key: 'itemId', fixed: 'left' as const, width: 120,
      render: (val: any, record: any) =>
        record.isGroupHeader ? '-' : <Text style={{ fontSize: '12px' }}>{val}</Text>,
    },
    {
      title: '产线', dataIndex: 'chosenLine', key: 'chosenLine', fixed: 'left' as const, width: 70,
      render: (text: string, record: any) =>
        record.isGroupHeader ? null : <Tag color="cyan">{text}</Tag>,
    },
    {
      title: 'UPH', dataIndex: 'uph', key: 'uph', fixed: 'left' as const, width: 70,
      render: (val: any, record: any) =>
        (record.isGroupHeader || !val) ? '-' : <Text type="secondary">{formatNum(val, 1)}</Text>,
    },
    {
      title: '人力', dataIndex: 'headcount', key: 'headcount', fixed: 'left' as const, width: 60,
      render: (val: any, record: any) =>
        (record.isGroupHeader || !val) ? '-' : <Text type="secondary">{val}</Text>,
    },
    {
      title: '总排量', dataIndex: 'totalQty', key: 'totalQty', fixed: 'left' as const, align: 'right' as const, width: 80,
      render: (val: any, record: any) => (
        <Text strong style={{ color: record.isGroupHeader ? '#52c41a' : 'inherit' }}>{formatNum(val)}</Text>
      ),
    },
  ];

  const columns = [...baseColumns, ...dynamicDateColumns];

  // ── 渲染 ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '24px', backgroundColor: '#fff', borderRadius: '8px' }}>
      {/* 版本信息条（仅在从历史列表打开时显示） */}
      {runId && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12, borderRadius: 6 }}
          message={
            <span style={{ fontSize: 12 }}>
              当前查看版本：
              <span style={{ fontFamily: 'monospace', marginLeft: 6, fontWeight: 600 }}>{currentRunId}</span>
              <span style={{ color: '#8c8c8c', marginLeft: 12 }}>手工调整和重算均限定于此版本</span>
            </span>
          }
        />
      )}
      {/* 工具栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <Space size="large">
        <Title level={4} style={{ margin: 0 }}>车间排产动态矩阵 (Gantt)</Title>
        </Space>

        <Space wrap>
          <Text type="secondary" style={{ fontSize: '12px' }}>
            共计 {rawRecords.length} 条单据 | 日期跨度: {globalDates.length} 天
            {adjustedCount > 0 && (
              <> | <Tag color="orange" style={{ fontSize: 10 }}>✎ 已锁定 {adjustedCount} 条</Tag></>
            )}
          </Text>

          {/* 调整后重算（仅有锁定记录时显示）*/}
          {adjustedCount > 0 && (
            <Tooltip title={`将保留 ${adjustedCount} 条已锁定记录，对其余订单重新排产`}>
              <Button
                onClick={handleReSchedule} loading={reScheduling}
                style={{ borderColor: '#fa8c16', color: '#fa8c16' }}
              >
                调整后重算（{adjustedCount} 锁）
              </Button>
            </Tooltip>
          )}

          {/* 解锁全部并重排（Popconfirm 保护）*/}
          {adjustedCount > 0 && (
            <Popconfirm
              title={
                <div>
                  <div style={{ fontWeight: 600 }}>解锁全部 {adjustedCount} 条锁定记录并在当前版本内重排？</div>
                  <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                    此操作将清除当前版本的手工调整，并按所选开工日期重新排产，不可撤销。
                  </div>
                </div>
              }
              onConfirm={() => setUnlockRescheduleOpen(true)}
              okText="继续"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button danger size="small">解锁全部并版本内重排</Button>
            </Popconfirm>
          )}

          <Button type="primary" onClick={fetchScheduleData} loading={loading}>刷新数据</Button>
        </Space>
      </div>

      <Modal
        title="解锁全部并版本内重排"
        open={unlockRescheduleOpen}
        onCancel={() => setUnlockRescheduleOpen(false)}
        onOk={handleUnlockAllAndReschedule}
        okText="确认重排"
        cancelText="取消"
        okButtonProps={{ danger: true, loading: reScheduling }}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Alert
            type="warning"
            showIcon
            message="此操作会清除当前版本的手工调整，并按所选开工日期重新排产。"
          />
          <Space align="center" size={8}>
            <span>开工日期</span>
            <DatePicker
              format="YYYY-MM-DD"
              value={unlockRescheduleStartDate}
              onChange={(val: any) => setUnlockRescheduleStartDate(val || dayjs())}
              allowClear={false}
            />
          </Space>
        </Space>
      </Modal>

      {/* 拖拽树形视图（按产线排期）*/}
      <>
        <DraggableGantt
          records={flatGroupedData}
          globalDates={globalDates}
          factoryCalendar={factoryCalendar || {}}
          api={api}
          onSaved={fetchScheduleData}
          onClickRecord={openDrawer}
        />
        {/* 调整弹窗（点击条形时弹出） */}
        <AdjustDrawer
          open={drawerOpen}
          record={drawerRecord}
          onClose={closeDrawer}
          onSaved={fetchScheduleData}
          api={api}
        />
      </>
    </div>
  );
};

export default SchedulingGantt;
