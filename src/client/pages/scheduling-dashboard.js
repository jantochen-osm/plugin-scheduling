const { React, antd, libs } = ctx;
const { useState, useEffect, useMemo } = React;
const { Card, Table, Tag, Select, Statistic, Row, Col, Progress, Badge, Descriptions, Space, Spin, Empty, Tabs, Tooltip, Typography } = antd;
const dayjs = libs.dayjs;
const { Title, Text } = Typography;

// ─── API Helper ───
const api = ctx.api || ctx.apiClient || (ctx.app && ctx.app.apiClient);

async function fetchList(resource, params = {}) {
  const res = await api.request({
    url: `${resource}:list`,
    method: 'get',
    params: { paginate: false, pageSize: 9999, ...params },
  });
  return res?.data?.data || [];
}

// ─── Color Palette ───
const COLORS = {
  bg: '#0f1117',
  card: 'rgba(255,255,255,0.04)',
  cardBorder: 'rgba(255,255,255,0.08)',
  primary: '#4f8cff',
  success: '#52c41a',
  warning: '#faad14',
  danger: '#ff4d4f',
  info: '#36cfc9',
  text: 'rgba(255,255,255,0.88)',
  textSec: 'rgba(255,255,255,0.55)',
  textTer: 'rgba(255,255,255,0.35)',
};

const LINE_COLORS = { '3F3': '#4f8cff', '3F4': '#36cfc9', '3F5': '#b37feb', '3F6': '#ff85c0' };

// ─── Styled Card ───
function GlassCard({ title, extra, children, style }) {
  return React.createElement('div', {
    style: {
      background: COLORS.card,
      border: `1px solid ${COLORS.cardBorder}`,
      borderRadius: 12,
      padding: '20px 24px',
      backdropFilter: 'blur(12px)',
      ...style,
    }
  },
    title && React.createElement('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }
    },
      React.createElement('span', { style: { fontSize: 15, fontWeight: 600, color: COLORS.text } }, title),
      extra,
    ),
    children,
  );
}

// ─── Utilization Bar ───
function UtilBar({ line, data }) {
  const color = LINE_COLORS[line] || COLORS.primary;
  const rate = data.utilizationRate || 0;
  return React.createElement('div', { style: { marginBottom: 16 } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 4 } },
      React.createElement('span', { style: { color: COLORS.text, fontWeight: 500 } },
        React.createElement('span', {
          style: { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, marginRight: 8 }
        }),
        line,
      ),
      React.createElement('span', { style: { color: COLORS.textSec, fontSize: 12 } },
        `${data.orderCount}单 · ${data.usedHours}h / ${data.totalCapacityHours}h · ${data.peakDayCount}天满载`,
      ),
    ),
    React.createElement('div', {
      style: { height: 20, background: 'rgba(255,255,255,0.06)', borderRadius: 10, overflow: 'hidden', position: 'relative' }
    },
      React.createElement('div', {
        style: {
          height: '100%',
          width: `${Math.min(rate, 100)}%`,
          background: `linear-gradient(90deg, ${color}, ${color}aa)`,
          borderRadius: 10,
          transition: 'width 0.8s ease',
        }
      }),
      React.createElement('span', {
        style: {
          position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
          fontSize: 11, fontWeight: 600, color: rate > 60 ? '#fff' : COLORS.textSec,
        }
      }, `${rate}%`),
    ),
  );
}

// ─── Exception Breakdown ───
function ExcBreakdown({ data }) {
  if (!data || Object.keys(data).length === 0) return React.createElement(Empty, { description: '无异常', image: Empty.PRESENTED_IMAGE_SIMPLE });

  const tagColor = {
    PAST_DLV_DATE: 'volcano', MISSING_ROUTE: 'red', CALENDAR_EXHAUSTED: 'orange',
    DELIVERY_AT_RISK: 'gold', PAST_DUE_SCHEDULED: 'purple', MISSING_DLV_DATE: 'magenta', INVALID_QTY: 'cyan',
  };
  const labels = {
    PAST_DLV_DATE: '已过交期', MISSING_ROUTE: '缺路线', CALENDAR_EXHAUSTED: '产能耗尽',
    DELIVERY_AT_RISK: '排产逾期', PAST_DUE_SCHEDULED: '已过期排产', MISSING_DLV_DATE: '缺交期', INVALID_QTY: '数量无效',
  };
  const total = Object.values(data).reduce((s, v) => s + v, 0);

  return React.createElement('div', null,
    Object.entries(data).sort((a, b) => b[1] - a[1]).map(([type, count]) =>
      React.createElement('div', {
        key: type,
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, padding: '6px 0' }
      },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement(Tag, { color: tagColor[type] || 'default', style: { margin: 0 } }, labels[type] || type),
        ),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement('span', { style: { color: COLORS.text, fontWeight: 600, fontSize: 16 } }, count),
          React.createElement('span', { style: { color: COLORS.textTer, fontSize: 12 } },
            `${(count / total * 100).toFixed(1)}%`
          ),
        ),
      )
    ),
  );
}

// ─── Main Dashboard ───
function SchedulingDashboard() {
  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [results, setResults] = useState([]);
  const [exceptions, setExceptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  // Load runs list
  useEffect(() => {
    setLoading(true);
    fetchList('schedule_runs').then(data => {
      const sorted = data.sort((a, b) => new Date(b.runTime) - new Date(a.runTime));
      setRuns(sorted);
      if (sorted.length > 0) setSelectedRunId(sorted[0].runId);
      setLoading(false);
    });
  }, []);

  // Load details for selected run
  useEffect(() => {
    if (!selectedRunId) return;
    setDetailLoading(true);
    Promise.all([
      fetchList('schedule_results_v2', { filter: JSON.stringify({ runId: selectedRunId }) }),
      fetchList('schedule_exceptions_v2', { filter: JSON.stringify({ runId: selectedRunId }) }),
    ]).then(([r, e]) => {
      setResults(r);
      setExceptions(e);
      setDetailLoading(false);
    });
  }, [selectedRunId]);

  const selectedRun = useMemo(() => runs.find(r => r.runId === selectedRunId), [runs, selectedRunId]);

  // ─── Result Table Columns ───
  const resultColumns = [
    {
      title: '生产单号', dataIndex: 'prodId', width: 140, fixed: 'left',
      render: v => React.createElement(Text, { style: { color: COLORS.primary, fontWeight: 500 } }, v),
    },
    { title: '物料', dataIndex: 'itemId', width: 110 },
    { title: '数量', dataIndex: 'totalQty', width: 80, align: 'right', sorter: (a, b) => a.totalQty - b.totalQty },
    { title: '交期', dataIndex: 'dlvDate', width: 100,
      render: v => v ? dayjs(v).format('MM-DD') : '-',
      sorter: (a, b) => new Date(a.dlvDate) - new Date(b.dlvDate),
    },
    {
      title: '产线', dataIndex: 'chosenLine', width: 60,
      render: v => React.createElement(Tag, {
        color: LINE_COLORS[v] || COLORS.primary,
        style: { borderRadius: 4, fontWeight: 500 }
      }, v),
    },
    { title: 'UPH', dataIndex: 'uph', width: 60, align: 'right' },
    {
      title: '开始', dataIndex: 'startDate', width: 100,
      render: v => v ? dayjs(v).format('MM-DD') : '-',
    },
    {
      title: '完成', dataIndex: 'finishDate', width: 100,
      render: v => v ? dayjs(v).format('MM-DD') : '-',
    },
    {
      title: '状态', dataIndex: 'overdueType', width: 90,
      filters: [
        { text: '按时', value: 'ON_TIME' },
        { text: '排产逾期', value: 'AT_RISK' },
        { text: '已过交期', value: 'PAST_DUE' },
      ],
      onFilter: (val, record) => record.overdueType === val,
      render: (v, record) => {
        const map = {
          ON_TIME: { color: 'success', text: '按时' },
          AT_RISK: { color: 'warning', text: `逾期${record.overdueDays || ''}天` },
          PAST_DUE: { color: 'error', text: '已过交期' },
        };
        const m = map[v] || { color: 'default', text: v || '-' };
        return React.createElement(Tag, { color: m.color, style: { borderRadius: 4 } }, m.text);
      },
    },
    {
      title: '每日计划', dataIndex: 'dailyPlan', width: 220, ellipsis: true,
      render: v => {
        if (!v || typeof v !== 'object') return '-';
        const entries = Object.entries(v).sort();
        return React.createElement(Tooltip, {
          title: entries.map(([d, q]) => `${dayjs(d).format('MM-DD')}: ${q}`).join('\n'),
          overlayStyle: { whiteSpace: 'pre-wrap' },
        },
          React.createElement('div', {
            style: { display: 'flex', gap: 2, alignItems: 'flex-end', height: 28, cursor: 'pointer' }
          },
            entries.map(([d, q]) => {
              const maxQ = Math.max(...entries.map(e => e[1]));
              const h = maxQ > 0 ? Math.max(4, (q / maxQ) * 24) : 4;
              return React.createElement('div', {
                key: d,
                style: {
                  width: Math.max(6, Math.min(16, 180 / entries.length)),
                  height: h,
                  background: LINE_COLORS[results.find(r => r.prodId === v.prodId)?.chosenLine] || COLORS.primary,
                  borderRadius: 2, opacity: 0.8,
                }
              });
            }),
          ),
        );
      },
    },
  ];

  // ─── Exception Table Columns ───
  const excColumns = [
    { title: '生产单号', dataIndex: 'prodId', width: 140 },
    { title: '物料', dataIndex: 'itemId', width: 110 },
    {
      title: '类型', dataIndex: 'exceptionType', width: 120,
      filters: [
        { text: '已过交期', value: 'PAST_DLV_DATE' },
        { text: '缺路线', value: 'MISSING_ROUTE' },
        { text: '产能耗尽', value: 'CALENDAR_EXHAUSTED' },
        { text: '排产逾期', value: 'DELIVERY_AT_RISK' },
      ],
      onFilter: (val, record) => record.exceptionType === val,
      render: v => {
        const colors = {
          PAST_DLV_DATE: 'volcano', MISSING_ROUTE: 'red', CALENDAR_EXHAUSTED: 'orange',
          DELIVERY_AT_RISK: 'gold', PAST_DUE_SCHEDULED: 'purple',
        };
        return React.createElement(Tag, { color: colors[v] || 'default' }, v);
      },
    },
    {
      title: '严重度', dataIndex: 'severity', width: 80,
      render: v => React.createElement(Tag, { color: v === 'BLOCKER' ? 'red' : 'gold' }, v),
    },
    { title: '说明', dataIndex: 'message', ellipsis: true },
  ];

  if (loading) {
    return React.createElement('div', {
      style: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', background: COLORS.bg }
    }, React.createElement(Spin, { size: 'large' }));
  }

  if (runs.length === 0) {
    return React.createElement('div', {
      style: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', background: COLORS.bg }
    }, React.createElement(Empty, { description: '暂无排产运行记录' }));
  }

  const lineUtil = selectedRun?.lineUtilization || [];
  const excBreakdown = selectedRun?.exceptionBreakdown || {};
  const totalUtil = lineUtil.length > 0
    ? Math.round(lineUtil.reduce((s, l) => s + l.utilizationRate, 0) / lineUtil.length * 10) / 10
    : 0;

  return React.createElement('div', {
    style: {
      background: COLORS.bg,
      minHeight: '100vh',
      padding: '24px 28px',
      color: COLORS.text,
      fontFamily: "'Inter', -apple-system, sans-serif",
    }
  },
    // ─── Header ───
    React.createElement('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }
    },
      React.createElement('div', null,
        React.createElement('h2', { style: { color: COLORS.text, margin: 0, fontSize: 22, fontWeight: 700 } }, '📊 排产运行报告'),
        React.createElement('span', { style: { color: COLORS.textTer, fontSize: 13 } }, '每次排产的详细数据、产线利用率与异常分析'),
      ),
      React.createElement(Select, {
        value: selectedRunId,
        onChange: setSelectedRunId,
        style: { width: 300 },
        dropdownStyle: { background: '#1a1d27' },
        options: runs.map(r => ({
          value: r.runId,
          label: `${r.runId} · ${dayjs(r.runTime).format('MM-DD HH:mm')} · ${r.successRate}%`,
        })),
      }),
    ),

    // ─── KPI Cards ───
    React.createElement(Row, { gutter: 16, style: { marginBottom: 20 } },
      [
        { title: '总订单', value: selectedRun?.totalOrders, color: COLORS.textSec },
        { title: '有效订单', value: selectedRun?.validOrders, color: COLORS.primary },
        { title: '排产成功', value: selectedRun?.scheduledCount, color: COLORS.success },
        { title: '异常数', value: selectedRun?.exceptionCount, color: COLORS.warning },
        { title: '成功率', value: `${selectedRun?.successRate || 0}%`, color: (selectedRun?.successRate || 0) >= 80 ? COLORS.success : COLORS.danger },
        { title: '综合利用率', value: `${totalUtil}%`, color: totalUtil >= 50 ? COLORS.info : COLORS.warning },
      ].map((item, i) =>
        React.createElement(Col, { span: 4, key: i },
          React.createElement(GlassCard, null,
            React.createElement('div', { style: { color: COLORS.textSec, fontSize: 12, marginBottom: 4 } }, item.title),
            React.createElement('div', { style: { color: item.color, fontSize: 28, fontWeight: 700, lineHeight: 1.2 } },
              typeof item.value === 'number' ? item.value.toLocaleString() : item.value,
            ),
          ),
        ),
      ),
    ),

    // ─── Line Utilization + Exception Breakdown ───
    React.createElement(Row, { gutter: 16, style: { marginBottom: 20 } },
      React.createElement(Col, { span: 14 },
        React.createElement(GlassCard, { title: '🏭 产线利用率' },
          lineUtil.length > 0
            ? lineUtil.map(lu => React.createElement(UtilBar, { key: lu.line, line: lu.line, data: lu }))
            : React.createElement(Empty, { description: '无数据', image: Empty.PRESENTED_IMAGE_SIMPLE }),
        ),
      ),
      React.createElement(Col, { span: 10 },
        React.createElement(GlassCard, { title: '⚠️ 异常分布' },
          React.createElement(ExcBreakdown, { data: excBreakdown }),
        ),
      ),
    ),

    // ─── Detail Tabs ───
    React.createElement(GlassCard, null,
      React.createElement(Tabs, {
        items: [
          {
            key: 'results',
            label: `排产结果 (${results.length})`,
            children: React.createElement(Table, {
              dataSource: results,
              columns: resultColumns,
              rowKey: 'id',
              size: 'small',
              loading: detailLoading,
              scroll: { x: 1200 },
              pagination: { pageSize: 15, showSizeChanger: true, showTotal: t => `共 ${t} 条` },
              style: { background: 'transparent' },
            }),
          },
          {
            key: 'exceptions',
            label: `异常明细 (${exceptions.length})`,
            children: React.createElement(Table, {
              dataSource: exceptions,
              columns: excColumns,
              rowKey: 'id',
              size: 'small',
              loading: detailLoading,
              pagination: { pageSize: 15, showSizeChanger: true, showTotal: t => `共 ${t} 条` },
            }),
          },
        ],
      }),
    ),
  );
}

ctx.render(React.createElement(SchedulingDashboard));
