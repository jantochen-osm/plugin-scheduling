const { React, antd, libs } = ctx;
const { useState, useEffect, useMemo } = React;
const {
  Card, Table, Tag, Select, Statistic, Row, Col,
  Progress, Badge, Descriptions, Space, Spin, Empty, Tabs, Tooltip, Typography,
} = antd;
const dayjs = libs.dayjs;
const { Title, Text } = Typography;

// ─── API Helper ───────────────────────────────────────────────────────────────
const api = ctx.api || ctx.apiClient || (ctx.app && ctx.app.apiClient);

async function fetchList(resource, params = {}) {
  const res = await api.request({
    url: `${resource}:list`,
    method: 'get',
    params: { paginate: false, pageSize: 9999, ...params },
  });
  return res?.data?.data || [];
}

// ─── Color Palette ────────────────────────────────────────────────────────────
const COLORS = {
  bg:         '#0f1117',
  card:       'rgba(255,255,255,0.04)',
  cardBorder: 'rgba(255,255,255,0.08)',
  primary:    '#4f8cff',
  success:    '#52c41a',
  warning:    '#faad14',
  danger:     '#ff4d4f',
  info:       '#36cfc9',
  text:       'rgba(255,255,255,0.88)',
  textSec:    'rgba(255,255,255,0.55)',
  textTer:    'rgba(255,255,255,0.35)',
};

// ESG 产线颜色（动态加载，初始值与 LINE_COLORS 一致作为降级）
let ESG_LINE_COLORS = { ...LINE_COLORS };

// 从 API 加载 ESG 产线颜色配置
async function loadESGColors() {
  try {
    const res = await api.request({
      url: 'esg_line_config:list',
      method: 'get',
      params: { paginate: false, sort: ['sort'] },
    });
    const items = res?.data?.data || [];
    if (items.length > 0) {
      ESG_LINE_COLORS = { ...LINE_COLORS }; // 保留 EE 颜色
      for (const item of items) {
        if (item.isActive) ESG_LINE_COLORS[item.lineCode] = item.color || '#40a9ff';
      }
    }
  } catch {
    // 降级：保持硬编码默认值
  }
}

// 日期类型颜色：工作日 / 周末
const DAY_TYPE_COLORS = {
  WORKDAY:  { barBg: 'transparent',            colBg: 'transparent' },
  WEEKEND:  { barBg: 'rgba(255,255,255,0.18)', colBg: 'rgba(255,255,255,0.04)' },
  OUT_RANGE:{ barBg: 'transparent',            colBg: 'rgba(0,0,0,0.25)' },  // 订单范围外
};

// ─── 工具：日期字符串 YYYY-MM-DD ─────────────────────────────────────────────
function toDateStr(v) {
  if (!v) return '';
  return dayjs(v).format('YYYY-MM-DD');
}

// ─── Glass Card ──────────────────────────────────────────────────────────────
function GlassCard({ title, extra, children, style }) {
  return React.createElement('div', {
    style: {
      background: COLORS.card,
      border: `1px solid ${COLORS.cardBorder}`,
      borderRadius: 12,
      padding: '20px 24px',
      backdropFilter: 'blur(12px)',
      ...style,
    },
  },
    title && React.createElement('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    },
      React.createElement('span', { style: { fontSize: 15, fontWeight: 600, color: COLORS.text } }, title),
      extra,
    ),
    children,
  );
}

// ─── Utilization Bar ─────────────────────────────────────────────────────────
function UtilBar({ line, data }) {
  const color = ESG_LINE_COLORS[line] || COLORS.primary;
  const rate  = data.utilizationRate || 0;
  return React.createElement('div', { style: { marginBottom: 16 } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 4 } },
      React.createElement('span', { style: { color: COLORS.text, fontWeight: 500 } },
        React.createElement('span', {
          style: { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, marginRight: 8 },
        }),
        line,
      ),
      React.createElement('span', { style: { color: COLORS.textSec, fontSize: 12 } },
        `${data.orderCount}单 · ${data.usedHours}h / ${data.totalCapacityHours}h`,
      ),
    ),
    React.createElement('div', {
      style: { height: 20, background: 'rgba(255,255,255,0.06)', borderRadius: 10, overflow: 'hidden', position: 'relative' },
    },
      React.createElement('div', {
        style: {
          height: '100%',
          width: `${Math.min(rate, 100)}%`,
          background: `linear-gradient(90deg, ${color}, ${color}aa)`,
          borderRadius: 10,
          transition: 'width 0.8s ease',
        },
      }),
      React.createElement('span', {
        style: {
          position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
          fontSize: 11, fontWeight: 600, color: rate > 60 ? '#fff' : COLORS.textSec,
        },
      }, `${rate}%`),
    ),
  );
}

// ─── Exception Breakdown ─────────────────────────────────────────────────────
function ExcBreakdown({ data }) {
  if (!data || Object.keys(data).length === 0)
    return React.createElement(Empty, { description: '无异常', image: Empty.PRESENTED_IMAGE_SIMPLE });

  const tagColor = {
    PAST_DLV_DATE: 'volcano', MISSING_ROUTE: 'red', CALENDAR_EXHAUSTED: 'orange',
    DELIVERY_AT_RISK: 'gold', PAST_DUE_SCHEDULED: 'purple', MISSING_DLV_DATE: 'magenta',
  };
  const labels = {
    PAST_DLV_DATE: '已过交期', MISSING_ROUTE: '缺路线', CALENDAR_EXHAUSTED: '产能耗尽',
    DELIVERY_AT_RISK: '排产逾期', PAST_DUE_SCHEDULED: '已过期排产', MISSING_DLV_DATE: '缺交期',
  };
  const total = Object.values(data).reduce((s, v) => s + v, 0);

  return React.createElement('div', null,
    Object.entries(data).sort((a, b) => b[1] - a[1]).map(([type, count]) =>
      React.createElement('div', {
        key: type,
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, padding: '6px 0' },
      },
        React.createElement(Tag, { color: tagColor[type] || 'default', style: { margin: 0 } }, labels[type] || type),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement('span', { style: { color: COLORS.text, fontWeight: 600, fontSize: 16 } }, count),
          React.createElement('span', { style: { color: COLORS.textTer, fontSize: 12 } },
            `${(count / total * 100).toFixed(1)}%`,
          ),
        ),
      ),
    ),
  );
}

// ─── 迷你甘特条（每日计划小图）────────────────────────────────────────────────
function MiniGantt({ record, globalDates, barWidth }) {
  const plan        = record.dailyPlan  || {};
  const lineColor   = ESG_LINE_COLORS[record.chosenLine] || COLORS.primary;
  const startStr    = toDateStr(record.startDate);
  const finishStr   = toDateStr(record.finishDate);
  const maxQ        = Math.max(...globalDates.map(d => plan[d] || 0), 1);

  // tooltip：只列有产量的日期
  const tipLines = globalDates
    .filter(d => (plan[d] || 0) > 0)
    .map(d => `${dayjs(d).format('MM-DD')}: ${Math.round(plan[d])}`);

  const bars = globalDates.map(d => {
    const qty       = plan[d] || 0;
    const dow       = new Date(d + 'T00:00:00').getDay();
    const isWeekend = dow === 0 || dow === 6;
    const inRange   = d >= startStr && d <= finishStr;
    const dayType   = !inRange ? 'OUT_RANGE' : isWeekend ? 'WEEKEND' : 'WORKDAY';
    const dc        = DAY_TYPE_COLORS[dayType];
    const barH      = qty > 0 ? Math.max(3, (qty / maxQ) * 24) : (inRange ? 2 : 0);

    return React.createElement('div', {
      key: d,
      style: {
        width: barWidth,
        height: 28,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        background: dc.colBg,
        borderLeft: isWeekend ? `1px solid ${dc.barBg}` : 'none',
        flexShrink: 0,
      },
    },
      barH > 0 && React.createElement('div', {
        style: {
          width: '100%',
          height: barH,
          background: qty > 0 ? lineColor : 'rgba(255,255,255,0.15)',
          borderRadius: '1px 1px 0 0',
          opacity: qty > 0 ? 0.85 : 0.4,
        },
      }),
    );
  });

  return React.createElement(Tooltip, {
    title: React.createElement('div', { style: { whiteSpace: 'pre', fontSize: 11 } },
      tipLines.length > 0 ? tipLines.join('\n') : '本单无产量',
    ),
    placement: 'topLeft',
  },
    React.createElement('div', {
      style: { display: 'flex', alignItems: 'flex-end', height: 28, cursor: 'pointer', overflow: 'hidden' },
    }, bars),
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
function SchedulingDashboard() {
  const [runs,          setRuns]          = useState([]);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [results,       setResults]       = useState([]);
  const [exceptions,    setExceptions]    = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  // 加载 ESG 产线颜色配置
  useEffect(() => {
    loadESGColors();
  }, []);

  // ── 全局日期序列（方案A）：
  //    合并所有订单的 startDate–finishDate 形成连续日期轴，包含范围外的日期用灰色显示
  const globalDates = useMemo(() => {
    if (results.length === 0) return [];
    // 收集全局最早/最晚日期
    let minDate = '';
    let maxDate = '';
    for (const r of results) {
      const s = toDateStr(r.startDate);
      const f = toDateStr(r.finishDate);
      if (!minDate || s < minDate) minDate = s;
      if (!maxDate || f > maxDate) maxDate = f;
    }
    if (!minDate || !maxDate) return [];
    // 生成连续日期数组
    const dates = [];
    const cursor = new Date(minDate + 'T00:00:00');
    const end    = new Date(maxDate + 'T00:00:00');
    while (cursor <= end) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  }, [results]);

  // 每格宽度（日期越多宽度越窄，最小 3px，最大 14px）
  const barWidth = useMemo(() => {
    if (globalDates.length === 0) return 8;
    return Math.max(3, Math.min(14, Math.floor(600 / globalDates.length)));
  }, [globalDates]);

  // ── 加载运行列表
  useEffect(() => {
    setLoading(true);
    fetchList('schedule_runs', { sort: '-id' }).then(data => {
      setRuns(data);
      if (data.length > 0) setSelectedRunId(data[0].runId);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // ── 加载选中运行的详情
  useEffect(() => {
    if (!selectedRunId) return;
    setDetailLoading(true);
    Promise.all([
      fetchList('schedule_results_v2',    { sort: 'startDate', filter: JSON.stringify({ runId: selectedRunId }) }),
      fetchList('schedule_exceptions_v2', { filter: JSON.stringify({ runId: selectedRunId }) }),
    ]).then(([r, e]) => {
      setResults(r);
      setExceptions(e);
      setDetailLoading(false);
    }).catch(() => setDetailLoading(false));
  }, [selectedRunId]);

  const selectedRun = useMemo(() => runs.find(r => r.runId === selectedRunId), [runs, selectedRunId]);

  // ─── 结果表格列 ───────────────────────────────────────────────────────────
  const ganttColWidth = Math.min(650, Math.max(200, globalDates.length * barWidth + 20));

  const resultColumns = [
    {
      title: '生产单号', dataIndex: 'prodId', width: 130, fixed: 'left',
      render: v => React.createElement(Text, { style: { color: COLORS.primary, fontWeight: 500 } }, v),
    },
    { title: '物料',   dataIndex: 'itemId',   width: 110 },
    { title: '数量',   dataIndex: 'totalQty', width: 75, align: 'right',
      sorter: (a, b) => a.totalQty - b.totalQty },
    { title: '交期',   dataIndex: 'dlvDate',  width: 90,
      render: v => v ? dayjs(v).format('MM-DD') : '-',
      sorter: (a, b) => new Date(a.dlvDate) - new Date(b.dlvDate) },
    {
      title: '产线', dataIndex: 'chosenLine', width: 60,
      render: v => React.createElement(Tag, {
        color: ESG_LINE_COLORS[v] ? undefined : 'default',
        style: { borderRadius: 4, fontWeight: 600, background: ESG_LINE_COLORS[v] || undefined, color: ESG_LINE_COLORS[v] ? '#000' : undefined },
      }, v),
    },
    { title: 'UPH', dataIndex: 'uph', width: 60, align: 'right' },
    { title: '开始', dataIndex: 'startDate',  width: 85,
      render: v => v ? dayjs(v).format('MM-DD') : '-' },
    { title: '完成', dataIndex: 'finishDate', width: 85,
      render: v => v ? dayjs(v).format('MM-DD') : '-' },
    {
      title: '状态', dataIndex: 'overdueType', width: 90,
      filters: [
        { text: '按时',   value: 'ON_TIME'  },
        { text: '排产逾期', value: 'AT_RISK'  },
        { text: '已过交期', value: 'PAST_DUE' },
      ],
      onFilter: (val, rec) => rec.overdueType === val,
      render: (v, rec) => {
        const map = {
          ON_TIME:  { color: 'success', text: '按时' },
          AT_RISK:  { color: 'warning', text: `逾期${rec.overdueDays || ''}天` },
          PAST_DUE: { color: 'error',   text: '已过交期' },
        };
        const m = map[v] || { color: 'default', text: v || '-' };
        return React.createElement(Tag, { color: m.color, style: { borderRadius: 4 } }, m.text);
      },
    },
    {
      // 方案A：X 轴 = 全局连续日期，包含全部订单的 startDate~finishDate 范围
      title: () => React.createElement('div', { style: { fontSize: 12 } },
        '每日排产甘特图',
        globalDates.length > 0 && React.createElement('span', {
          style: { color: COLORS.textTer, marginLeft: 8, fontWeight: 400 },
        },
          `${dayjs(globalDates[0]).format('MM/DD')} – ${dayjs(globalDates[globalDates.length - 1]).format('MM/DD')} (${globalDates.length}天)`
        ),
      ),
      dataIndex: 'dailyPlan',
      width: ganttColWidth,
      render: (_, record) => React.createElement(MiniGantt, { record, globalDates, barWidth }),
    },
  ];

  // ─── 异常表格列 ───────────────────────────────────────────────────────────
  const excColumns = [
    { title: '生产单号', dataIndex: 'prodId', width: 130 },
    { title: '物料',     dataIndex: 'itemId', width: 110 },
    {
      title: '类型', dataIndex: 'exceptionType', width: 130,
      filters: [
        { text: '已过交期', value: 'PAST_DLV_DATE'     },
        { text: '缺路线',   value: 'MISSING_ROUTE'     },
        { text: '产能耗尽', value: 'CALENDAR_EXHAUSTED' },
        { text: '排产逾期', value: 'DELIVERY_AT_RISK'   },
      ],
      onFilter: (val, rec) => rec.exceptionType === val,
      render: v => {
        const map = {
          PAST_DLV_DATE: 'volcano', MISSING_ROUTE: 'red',
          CALENDAR_EXHAUSTED: 'orange', DELIVERY_AT_RISK: 'gold',
        };
        return React.createElement(Tag, { color: map[v] || 'default' }, v);
      },
    },
    {
      title: '严重度', dataIndex: 'severity', width: 80,
      render: v => React.createElement(Tag, { color: v === 'BLOCKER' ? 'red' : 'gold' }, v),
    },
    { title: '说明', dataIndex: 'message', ellipsis: true },
  ];

  // ─── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return React.createElement('div', {
      style: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', background: COLORS.bg },
    }, React.createElement(Spin, { size: 'large' }));
  }

  if (runs.length === 0) {
    return React.createElement('div', {
      style: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', background: COLORS.bg },
    }, React.createElement(Empty, { description: '暂无排产运行记录，请先点击「运行排产」' }));
  }

  const lineUtil     = selectedRun?.lineUtilization    || [];
  const excBreakdown = selectedRun?.exceptionBreakdown || {};
  const totalUtil    = lineUtil.length > 0
    ? Math.round(lineUtil.reduce((s, l) => s + (l.utilizationRate || 0), 0) / lineUtil.length * 10) / 10
    : 0;

  return React.createElement('div', {
    style: {
      background: COLORS.bg,
      minHeight: '100vh',
      padding: '24px 28px',
      color: COLORS.text,
      fontFamily: "'Inter', -apple-system, sans-serif",
    },
  },

    // ─── Header ─────────────────────────────────────────────────────────────
    React.createElement('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
    },
      React.createElement('div', null,
        React.createElement('h2', { style: { color: COLORS.text, margin: 0, fontSize: 22, fontWeight: 700 } },
          '📊 排产运行报告',
        ),
        React.createElement('span', { style: { color: COLORS.textTer, fontSize: 13 } },
          '每次排产的详细数据、产线利用率与异常分析',
        ),
      ),
      React.createElement(Select, {
        value: selectedRunId,
        onChange: setSelectedRunId,
        style: { width: 340 },
        options: runs.map(r => ({
          value: r.runId,
          label: `${r.runId} · ${r.runTime ? dayjs(r.runTime).format('MM-DD HH:mm') : ''} · 成功${r.scheduledCount || 0}单`,
        })),
      }),
    ),

    // ─── KPI Cards ──────────────────────────────────────────────────────────
    React.createElement(Row, { gutter: 16, style: { marginBottom: 20 } },
      [
        { title: '总订单',   value: selectedRun?.totalOrders,     color: COLORS.textSec },
        { title: '有效订单', value: selectedRun?.validOrders,      color: COLORS.primary },
        { title: '排产成功', value: selectedRun?.scheduledCount,   color: COLORS.success },
        { title: '异常数',   value: selectedRun?.exceptionCount,   color: COLORS.warning },
        { title: '成功率',   value: `${selectedRun?.successRate || 0}%`,
          color: (selectedRun?.successRate || 0) >= 80 ? COLORS.success : COLORS.danger },
        { title: '综合利用率', value: `${totalUtil}%`,
          color: totalUtil >= 50 ? COLORS.info : COLORS.warning },
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

    // ─── Line Utilization + Exception Breakdown ──────────────────────────────
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

    // ─── Detail Tabs ─────────────────────────────────────────────────────────
    React.createElement(GlassCard, null,
      React.createElement(Tabs, {
        items: [
          {
            key: 'results',
            label: `排产结果 (${results.length})`,
            children: React.createElement(Table, {
              dataSource: results,
              columns:    resultColumns,
              rowKey:     'id',
              size:       'small',
              loading:    detailLoading,
              scroll:     { x: 900 + ganttColWidth },
              pagination: { pageSize: 20, showSizeChanger: true, showTotal: t => `共 ${t} 条` },
              style:      { background: 'transparent' },
            }),
          },
          {
            key: 'exceptions',
            label: `异常明细 (${exceptions.length})`,
            children: React.createElement(Table, {
              dataSource: exceptions,
              columns:    excColumns,
              rowKey:     'id',
              size:       'small',
              loading:    detailLoading,
              pagination: { pageSize: 20, showSizeChanger: true, showTotal: t => `共 ${t} 条` },
            }),
          },
        ],
      }),
    ),
  );
}

ctx.render(React.createElement(SchedulingDashboard));
