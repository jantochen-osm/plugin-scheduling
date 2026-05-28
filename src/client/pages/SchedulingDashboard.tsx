// @ts-nocheck
import React, { useState, useEffect, useMemo } from 'react';
import {
  Select, Table, Tag, Row, Col, Tabs, Spin, Empty, Tooltip,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import { useAPIClient } from '@nocobase/client';

const { Text } = Typography;

// ─── Color Palette ────────────────────────────────────────────────────────────
const C = {
  bg:         '#0f1117',
  card:       'rgba(255,255,255,0.04)',
  border:     'rgba(255,255,255,0.08)',
  primary:    '#4f8cff',
  success:    '#52c41a',
  warning:    '#faad14',
  danger:     '#ff4d4f',
  info:       '#36cfc9',
  text:       'rgba(255,255,255,0.88)',
  textSec:    'rgba(255,255,255,0.55)',
  textTer:    'rgba(255,255,255,0.35)',
};

const LINE_COLORS: Record<string, string> = {
  '3F3': '#4f8cff', '3F4': '#36cfc9', '3F5': '#b37feb', '3F6': '#ff85c0',
  '4F1': '#ff7a45', '4F2': '#ffc53d', '4F4': '#73d13d', '4F6': '#40a9ff',
};

// ─── API Helper ───────────────────────────────────────────────────────────────
async function fetchList(api: any, resource: string, params: any = {}) {
  const res = await api.request({
    url: `${resource}:list`,
    method: 'get',
    params: { paginate: false, pageSize: 9999, ...params },
  });
  return res?.data?.data || [];
}

function toDateStr(v: any): string {
  if (!v) return '';
  return dayjs(v).format('YYYY-MM-DD');
}

// ─── Glass Card ──────────────────────────────────────────────────────────────
function GlassCard({ title, children, style }: any) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 24px', ...style }}>
      {title && <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 16 }}>{title}</div>}
      {children}
    </div>
  );
}

// ─── Utilization Bar ─────────────────────────────────────────────────────────
function UtilBar({ line, data }: any) {
  const color = LINE_COLORS[line] || C.primary;
  const rate  = data.utilizationRate || 0;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ color: C.text, fontWeight: 500 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, marginRight: 8 }} />
          {line}
        </span>
        <span style={{ color: C.textSec, fontSize: 12 }}>
          {data.orderCount}单 · {data.usedHours}h / {data.totalCapacityHours}h
        </span>
      </div>
      <div style={{ height: 20, background: 'rgba(255,255,255,0.06)', borderRadius: 10, overflow: 'hidden', position: 'relative' }}>
        <div style={{ height: '100%', width: `${Math.min(rate, 100)}%`, background: `linear-gradient(90deg, ${color}, ${color}aa)`, borderRadius: 10, transition: 'width 0.8s ease' }} />
        <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, fontWeight: 600, color: rate > 60 ? '#fff' : C.textSec }}>
          {rate}%
        </span>
      </div>
    </div>
  );
}

// ─── Exception Breakdown ─────────────────────────────────────────────────────
const EXC_LABELS: Record<string, string> = {
  PAST_DLV_DATE: '已过交期', MISSING_ROUTE: '缺路线', CALENDAR_EXHAUSTED: '产能耗尽',
  DELIVERY_AT_RISK: '排产逾期', PAST_DUE_SCHEDULED: '已过期排产', MISSING_DLV_DATE: '缺交期',
};
const EXC_COLORS: Record<string, string> = {
  PAST_DLV_DATE: 'volcano', MISSING_ROUTE: 'red', CALENDAR_EXHAUSTED: 'orange',
  DELIVERY_AT_RISK: 'gold', PAST_DUE_SCHEDULED: 'purple',
};

function ExcBreakdown({ data }: any) {
  if (!data || Object.keys(data).length === 0)
    return <Empty description="无异常" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  const total = Object.values(data as Record<string, number>).reduce((s: number, v: any) => s + v, 0);
  return (
    <div>
      {Object.entries(data).sort((a: any, b: any) => b[1] - a[1]).map(([type, count]: any) => (
        <div key={type} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <Tag color={EXC_COLORS[type] || 'default'}>{EXC_LABELS[type] || type}</Tag>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: C.text, fontWeight: 600, fontSize: 16 }}>{count}</span>
            <span style={{ color: C.textTer, fontSize: 12 }}>{(count / total * 100).toFixed(1)}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Mini Gantt（方案A：全局连续日期轴）────────────────────────────────────────
function MiniGantt({ record, globalDates, barWidth }: any) {
  const plan      = record.dailyPlan || {};
  const lineColor = LINE_COLORS[record.chosenLine] || C.primary;
  const startStr  = toDateStr(record.startDate);
  const finishStr = toDateStr(record.finishDate);
  const maxQ      = Math.max(...globalDates.map((d: string) => plan[d] || 0), 1);

  const tipLines = globalDates
    .filter((d: string) => (plan[d] || 0) > 0)
    .map((d: string) => `${dayjs(d).format('MM-DD')}: ${Math.round(plan[d])}`);

  return (
    <Tooltip
      title={<div style={{ whiteSpace: 'pre', fontSize: 11 }}>{tipLines.length > 0 ? tipLines.join('\n') : '本单无产量'}</div>}
      placement="topLeft"
    >
      <div style={{ display: 'flex', alignItems: 'flex-end', height: 28, cursor: 'pointer', overflow: 'hidden' }}>
        {globalDates.map((d: string) => {
          const qty       = plan[d] || 0;
          const dow       = new Date(d + 'T00:00:00').getDay();
          const isWeekend = dow === 0 || dow === 6;
          const inRange   = d >= startStr && d <= finishStr;
          const barH      = qty > 0 ? Math.max(3, (qty / maxQ) * 24) : (inRange ? 2 : 0);

          return (
            <div
              key={d}
              style={{
                width: barWidth,
                height: 28,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                background: !inRange ? 'rgba(0,0,0,0.2)' : isWeekend ? 'rgba(255,255,255,0.04)' : 'transparent',
                borderLeft: isWeekend ? '1px solid rgba(255,255,255,0.15)' : 'none',
                flexShrink: 0,
              }}
            >
              {barH > 0 && (
                <div style={{
                  width: '100%',
                  height: barH,
                  background: qty > 0 ? lineColor : 'rgba(255,255,255,0.15)',
                  borderRadius: '1px 1px 0 0',
                  opacity: qty > 0 ? 0.85 : 0.4,
                }} />
              )}
            </div>
          );
        })}
      </div>
    </Tooltip>
  );
}

// ─── KPI Card ────────────────────────────────────────────────────────────────
function KpiCard({ title, value, color }: any) {
  return (
    <GlassCard>
      <div style={{ color: C.textSec, fontSize: 12, marginBottom: 4 }}>{title}</div>
      <div style={{ color, fontSize: 28, fontWeight: 700, lineHeight: 1.2 }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
    </GlassCard>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export function SchedulingDashboard() {
  const api = useAPIClient();
  const [runs,           setRuns]          = useState<any[]>([]);
  const [selectedRunId,  setSelectedRunId] = useState<string | null>(null);
  const [results,        setResults]       = useState<any[]>([]);
  const [exceptions,     setExceptions]    = useState<any[]>([]);
  const [loading,        setLoading]       = useState(true);
  const [detailLoading,  setDetailLoading] = useState(false);

  // 全局连续日期轴（方案A）：min(startDate) ~ max(finishDate)
  const globalDates = useMemo<string[]>(() => {
    if (results.length === 0) return [];
    let minD = '', maxD = '';
    for (const r of results) {
      const s = toDateStr(r.startDate), f = toDateStr(r.finishDate);
      if (!minD || s < minD) minD = s;
      if (!maxD || f > maxD) maxD = f;
    }
    if (!minD || !maxD) return [];
    const dates: string[] = [];
    const cur = new Date(minD + 'T00:00:00');
    const end = new Date(maxD + 'T00:00:00');
    while (cur <= end) {
      dates.push(cur.toISOString().slice(0, 10));
      cur.setDate(cur.getDate() + 1);
    }
    return dates;
  }, [results]);

  const barWidth = useMemo(() =>
    globalDates.length === 0 ? 8 : Math.max(3, Math.min(14, Math.floor(600 / globalDates.length)))
  , [globalDates]);

  // 加载运行列表（用 sort=-id 规避 runTime date 类型排序 ORM bug）
  useEffect(() => {
    setLoading(true);
    fetchList(api, 'schedule_runs', { sort: '-id' })
      .then((data: any[]) => {
        setRuns(data);
        if (data.length > 0) setSelectedRunId(data[0].runId);
      })
      .finally(() => setLoading(false));
  }, []);

  // 加载选中运行详情
  useEffect(() => {
    if (!selectedRunId) return;
    setDetailLoading(true);
    Promise.all([
      fetchList(api, 'schedule_results_v2', {
        sort: 'startDate',
        filter: JSON.stringify({ runId: selectedRunId }),
      }),
      fetchList(api, 'schedule_exceptions_v2', {
        filter: JSON.stringify({ runId: selectedRunId }),
      }),
    ]).then(([r, e]) => {
      setResults(r);
      setExceptions(e);
    }).finally(() => setDetailLoading(false));
  }, [selectedRunId]);

  const selectedRun = useMemo(() => runs.find(r => r.runId === selectedRunId), [runs, selectedRunId]);

  // ─── Gantt 列宽 ──────────────────────────────────────────────────────────
  const ganttW = Math.min(650, Math.max(200, globalDates.length * barWidth + 20));

  // ─── 结果表格列 ──────────────────────────────────────────────────────────
  const resultCols = [
    {
      title: '生产单号', dataIndex: 'prodId', width: 130, fixed: 'left' as const,
      render: (v: string) => <Text style={{ color: C.primary, fontWeight: 500 }}>{v}</Text>,
    },
    { title: '物料',   dataIndex: 'itemId',   width: 110 },
    { title: '数量',   dataIndex: 'totalQty', width: 75, align: 'right' as const,
      sorter: (a: any, b: any) => a.totalQty - b.totalQty },
    { title: '交期',   dataIndex: 'dlvDate',  width: 90,
      render: (v: string) => v ? dayjs(v).format('MM-DD') : '-',
      sorter: (a: any, b: any) => new Date(a.dlvDate).getTime() - new Date(b.dlvDate).getTime() },
    {
      title: '产线', dataIndex: 'chosenLine', width: 65,
      render: (v: string) => <Tag color={LINE_COLORS[v] ? undefined : 'default'} style={{ fontWeight: 600 }}>{v}</Tag>,
    },
    { title: 'UPH', dataIndex: 'uph', width: 60, align: 'right' as const },
    { title: '开始', dataIndex: 'startDate',  width: 85, render: (v: string) => v ? dayjs(v).format('MM-DD') : '-' },
    { title: '完成', dataIndex: 'finishDate', width: 85, render: (v: string) => v ? dayjs(v).format('MM-DD') : '-' },
    {
      title: '状态', dataIndex: 'overdueType', width: 95,
      filters: [
        { text: '按时',   value: 'ON_TIME'  },
        { text: '排产逾期', value: 'AT_RISK'  },
        { text: '已过交期', value: 'PAST_DUE' },
      ],
      onFilter: (val: any, rec: any) => rec.overdueType === val,
      render: (v: string, rec: any) => {
        const m: any = {
          ON_TIME:  { color: 'success', text: '按时' },
          AT_RISK:  { color: 'warning', text: `逾期${rec.overdueDays || ''}天` },
          PAST_DUE: { color: 'error',   text: '已过交期' },
        }[v] || { color: 'default', text: v || '-' };
        return <Tag color={m.color}>{m.text}</Tag>;
      },
    },
    {
      title: () => (
        <div style={{ fontSize: 12 }}>
          每日排产甘特图
          {globalDates.length > 0 && (
            <span style={{ color: C.textTer, marginLeft: 8, fontWeight: 400 }}>
              {dayjs(globalDates[0]).format('MM/DD')}–{dayjs(globalDates[globalDates.length - 1]).format('MM/DD')} ({globalDates.length}天)
            </span>
          )}
        </div>
      ),
      dataIndex: 'dailyPlan',
      width: ganttW,
      render: (_: any, record: any) => <MiniGantt record={record} globalDates={globalDates} barWidth={barWidth} />,
    },
  ];

  // ─── 异常表格列 ──────────────────────────────────────────────────────────
  const excCols = [
    { title: '生产单号', dataIndex: 'prodId', width: 130 },
    { title: '物料',     dataIndex: 'itemId', width: 110 },
    {
      title: '类型', dataIndex: 'exceptionType', width: 140,
      render: (v: string) => <Tag color={EXC_COLORS[v] || 'default'}>{EXC_LABELS[v] || v}</Tag>,
    },
    {
      title: '严重度', dataIndex: 'severity', width: 80,
      render: (v: string) => <Tag color={v === 'BLOCKER' ? 'red' : 'gold'}>{v}</Tag>,
    },
    { title: '说明', dataIndex: 'message', ellipsis: true },
  ];

  // ─── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', background: C.bg }}>
        <Spin size="large" />
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', background: C.bg }}>
        <Empty description="暂无排产记录，请先运行排产" />
      </div>
    );
  }

  const lineUtil     = selectedRun?.lineUtilization    || [];
  const excBreakdown = selectedRun?.exceptionBreakdown || {};
  const totalUtil    = lineUtil.length > 0
    ? Math.round(lineUtil.reduce((s: number, l: any) => s + (l.utilizationRate || 0), 0) / lineUtil.length * 10) / 10
    : 0;

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 28px', color: C.text, fontFamily: "'Inter', -apple-system, sans-serif" }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ color: C.text, margin: 0, fontSize: 22, fontWeight: 700 }}>📊 排产运行报告</h2>
          <span style={{ color: C.textTer, fontSize: 13 }}>每次排产的详细数据、产线利用率与异常分析</span>
        </div>
        <Select
          value={selectedRunId}
          onChange={setSelectedRunId}
          style={{ width: 360 }}
          options={runs.map((r: any) => ({
            value: r.runId,
            label: `${r.runId} · ${r.runTime ? dayjs(r.runTime).format('MM-DD HH:mm') : ''} · 成功${r.scheduledCount || 0}单`,
          }))}
        />
      </div>

      {/* KPI Cards */}
      <Row gutter={16} style={{ marginBottom: 20 }}>
        {[
          { title: '总订单',    value: selectedRun?.totalOrders,   color: C.textSec },
          { title: '有效订单',  value: selectedRun?.validOrders,    color: C.primary },
          { title: '排产成功',  value: selectedRun?.scheduledCount, color: C.success },
          { title: '异常数',    value: selectedRun?.exceptionCount, color: C.warning },
          { title: '成功率',    value: `${selectedRun?.successRate || 0}%`,
            color: (selectedRun?.successRate || 0) >= 80 ? C.success : C.danger },
          { title: '综合利用率', value: `${totalUtil}%`,
            color: totalUtil >= 50 ? C.info : C.warning },
        ].map((item, i) => (
          <Col span={4} key={i}>
            <KpiCard {...item} />
          </Col>
        ))}
      </Row>

      {/* 产线利用率 + 异常分布 */}
      <Row gutter={16} style={{ marginBottom: 20 }}>
        <Col span={14}>
          <GlassCard title="🏭 产线利用率">
            {lineUtil.length > 0
              ? lineUtil.map((lu: any) => <UtilBar key={lu.line} line={lu.line} data={lu} />)
              : <Empty description="无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </GlassCard>
        </Col>
        <Col span={10}>
          <GlassCard title="⚠️ 异常分布">
            <ExcBreakdown data={excBreakdown} />
          </GlassCard>
        </Col>
      </Row>

      {/* 详情 Tabs */}
      <GlassCard>
        <Tabs items={[
          {
            key: 'results',
            label: `排产结果 (${results.length})`,
            children: (
              <Table
                dataSource={results}
                columns={resultCols}
                rowKey="id"
                size="small"
                loading={detailLoading}
                scroll={{ x: 900 + ganttW }}
                pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t: number) => `共 ${t} 条` }}
                style={{ background: 'transparent' }}
              />
            ),
          },
          {
            key: 'exceptions',
            label: `异常明细 (${exceptions.length})`,
            children: (
              <Table
                dataSource={exceptions}
                columns={excCols}
                rowKey="id"
                size="small"
                loading={detailLoading}
                pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t: number) => `共 ${t} 条` }}
              />
            ),
          },
        ]} />
      </GlassCard>
    </div>
  );
}
