import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table, Button, Space, Select, Tag, Typography,
  Card, Statistic, Row, Col, Modal, Alert,
  Tooltip, message, DatePicker, Divider,
} from 'antd';
import {
  PlayCircleOutlined, ReloadOutlined, ArrowRightOutlined,
  CheckCircleOutlined, WarningOutlined, InfoCircleOutlined,
} from '@ant-design/icons';
import * as _dayjs from 'dayjs';
const dayjs: any = _dayjs;
const { RangePicker } = DatePicker;
const { Text, Title } = Typography;

// ============================================================================
// 类型
// ============================================================================
interface Order {
  prodId: string;
  itemId: string;
  qtySched: number;
  dlvDate: string;
  keyAccount: string;
  osmCategory: string;
  prodStatus: string;
  prodPoolId: string;
  project: string;
}

// ============================================================================
// 工具函数
// ============================================================================
const todayStr = dayjs().format('YYYY-MM-DD');

function isOverdue(dlvDate: string): boolean {
  return !!dlvDate && dlvDate < todayStr;
}

function mapRow(r: any): Order {
  return {
    prodId:      r.prodid      || r.prodId      || '',
    itemId:      r.itemid      || r.itemId      || '',
    qtySched:    Number(r.qtysched ?? r.qtySched) || 0,
    dlvDate:     r.dlvdate instanceof Date
      ? r.dlvdate.toISOString().split('T')[0]
      : r.dlvdate  ? String(r.dlvdate).split('T')[0]
      : r.dlvDate  ? String(r.dlvDate).split('T')[0]
      : '',
    keyAccount:  r.keyaccount  || r.keyAccount  || '',
    osmCategory: r.osm_category || r.osmCategory || '',
    prodStatus:  r.prodstatus  || r.prodStatus  || '',
    prodPoolId:  r.prodpoolid  || r.prodPoolId  || '',
    project:     r.project     || '',
  };
}

// ============================================================================
// 主组件（ESG 专用）
// ============================================================================
const SchedulingOrderSelector: React.FC<{ api: any; ganttPath?: string }> = ({ api, ganttPath }) => {
  const navigate = useNavigate();

  // ── 筛选状态 ──────────────────────────────────────────────────────────
  const [dlvDateRange, setDlvDateRange] = useState<[any, any] | null>(null);
  const [keyAccountFilter, setKeyAccountFilter] = useState<string | undefined>(undefined);

  // ── 分页 & 总条数 ────────────────────────────────────────────────────
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // ── 订单列表 ──────────────────────────────────────────────────────────
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  // ── 勾选 ──────────────────────────────────────────────────────────────
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // ── 执行状态 ──────────────────────────────────────────────────────────
  const [running, setRunning] = useState(false);

  // ── 开工日期（排产从该日期起排期）──────────────────────────────────────
  const [schedStartDate, setSchedStartDate] = useState<any>(dayjs());  // 默认今日

  // ── 弹窗 ──────────────────────────────────────────────────────────────
  const [resultOpen, setResultOpen]         = useState(false);
  const [runResult, setRunResult]           = useState<any>(null);
  const [exceptionOpen, setExceptionOpen]   = useState(false);

  // ── 最近运行摘要 ──────────────────────────────────────────────────────
  const [lastRun, setLastRun] = useState<any>(null);

  // ── 派生数据 ──────────────────────────────────────────────────────────
  const customerOptions = useMemo(() => {
    const set = new Set(allOrders.map(o => o.keyAccount).filter(Boolean));
    return Array.from(set).sort().map(v => ({ value: v, label: v }));
  }, [allOrders]);

  const overdueCount   = useMemo(() => allOrders.filter(o => isOverdue(o.dlvDate)).length, [allOrders]);
  const selectedCount  = selectedRowKeys.length;
  const isFullMode     = selectedCount === 0;

  // ── 加载最近运行摘要 ─────────────────────────────────────────────────
  const fetchLastRun = useCallback(async () => {
    try {
      const res = await api.request({ url: 'scheduling:lastRun', method: 'get' });
      const record = res?.data?.data?.data || res?.data?.data || null;
      if (record) setLastRun(record);
    } catch { /* ignore */ }
  }, [api]);

  // ── 加载订单（后端过滤 + 分页）──────────────────────────────────────
  const loadOrders = useCallback(async (page = 1, size = 20) => {
    setLoadingOrders(true);
    try {
      const filter: any = {};
      if (dlvDateRange?.[0]) filter.dlvdate = { $gte: dlvDateRange[0].format('YYYY-MM-DD') };
      if (dlvDateRange?.[1]) filter.dlvdate = { ...(filter.dlvdate || {}), $lte: dlvDateRange[1].format('YYYY-MM-DD') };
      if (keyAccountFilter)  filter.keyaccount = keyAccountFilter;

      const res = await api.request({
        url: 'scheduling:schedulablePools',
        method: 'get',
        params: {
          page,
          pageSize: size,
          sort: 'dlvdate',
          ...(Object.keys(filter).length > 0 ? { filter: JSON.stringify(filter) } : {}),
        },
      });

      // 后端返回: { data: [...], meta: { total, page, pageSize } }
      const body = res?.data?.data || {};
      console.log('loadOrders response:', body);
      const data: any[] = body.data || [];
      const total: number = body.meta?.total || 0;

      setAllOrders(data.map(mapRow));
      setTotal(total);
    } catch (e: any) {
      message.error('加载订单失败：' + (e?.message || '未知错误'));
    } finally {
      setLoadingOrders(false);
    }
  }, [api, dlvDateRange, keyAccountFilter]);

  // 挂载时自动加载 + 拉取最近运行摘要
  useEffect(() => {
    loadOrders();
    fetchLastRun();
  }, []);

  // 筛选条件变化时重新加载（重置到第1页）
  useEffect(() => {
    setCurrentPage(1);
    loadOrders(1, pageSize);
  }, [dlvDateRange, keyAccountFilter]);

  // ── 执行排产（ESG 固定） ──────────────────────────────────────────────
  const doRun = useCallback(async () => {
    setRunning(true);
    try {
      const prodIds = selectedCount > 0 ? (selectedRowKeys as string[]) : undefined;
      const res = await api.request({
        url: 'scheduling:run',
        method: 'post',
        data: {
          strategy: 'ESG',
          startDate: schedStartDate?.format('YYYY-MM-DD'),
          ...(prodIds ? { prodIds } : {}),
        },
      });
      const result = res?.data?.data || res?.data || {};
      setRunResult(result);
      fetchLastRun();

      // 通知甘特图自动刷新
      window.dispatchEvent(new CustomEvent('scheduling:refresh', {
        detail: { runId: result.runId, scheduledCount: result.scheduledCount },
      }));

      // 弹出结果弹窗
      setResultOpen(true);
    } catch (e: any) {
      message.error('排产执行失败：' + (e?.message || '未知错误'));
    } finally {
      setRunning(false);
    }
  }, [api, selectedRowKeys, selectedCount, fetchLastRun, schedStartDate]);

  // ── 确认弹窗 → 执行 ───────────────────────────────────────────────────
  const handleRun = useCallback(() => {
    Modal.confirm({
      title: '⚠️ 确认执行 ESG 排产',
      icon: <WarningOutlined style={{ color: '#faad14' }} />,
      width: 500,
      content: (
        <Space direction="vertical" style={{ width: '100%', marginTop: 8 }} size={12}>
          <Space size={6}>
            <Text type="secondary">开工日期：</Text>
            <Text strong style={{ color: '#1677ff' }}>
              {schedStartDate?.format('YYYY-MM-DD') || '今日'}
            </Text>
          </Space>
          {isFullMode ? (
            <Text>未勾选订单，将拉取 <strong>全部 ESG 有效订单</strong> 执行排产。</Text>
          ) : (
            <Text>
              已勾选 <strong style={{ color: '#1677ff', fontSize: 16 }}>{selectedCount}</strong> 条 ESG 订单参与本次排产。
            </Text>
          )}
          <Alert
            type="warning"
            showIcon
            style={{ fontSize: 12 }}
            message={
              isFullMode
                ? '全量覆盖：将清空所有旧排产结果（含人工调整记录），写入全新快照，不可撤销。'
                : `选中覆盖：将清空所有旧排产结果，仅写入本次选中的 ${selectedCount} 条订单排产结果，不可撤销。`
            }
          />
        </Space>
      ),
      okText: '确认执行',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: doRun,
    });
  }, [isFullMode, selectedCount, schedStartDate, doRun]);

  // ── 表格列定义（紧凑布局，总宽 ~720px）──────────────────────────────
  const columns = [
    {
      title: '生产单号',
      dataIndex: 'prodId',
      key: 'prodId',
      width: 120,
      fixed: 'left' as const,
      render: (val: string, record: Order) => (
        <Space direction="vertical" size={0}>
          <Text strong style={{ fontSize: 11 }}>{val}</Text>
          {isOverdue(record.dlvDate) && (
            <Tag color="red" style={{ fontSize: 9, padding: '0 2px', margin: 0 }}>逾期</Tag>
          )}
        </Space>
      ),
    },
    {
      title: 'Project',
      dataIndex: 'project',
      key: 'project',
      width: 90,
      ellipsis: true,
      render: (val: string) =>
        val ? <Text style={{ fontSize: 11 }}>{val}</Text> : <Text type="secondary">-</Text>,
    },
    {
      title: '物料',
      dataIndex: 'itemId',
      key: 'itemId',
      width: 90,
      ellipsis: true,
      render: (val: string) => <Text style={{ fontSize: 11 }}>{val}</Text>,
    },
    {
      title: '数量',
      dataIndex: 'qtySched',
      key: 'qtySched',
      width: 65,
      align: 'right' as const,
      render: (val: number) => val?.toLocaleString(),
    },
    {
      title: '交期',
      dataIndex: 'dlvDate',
      key: 'dlvDate',
      width: 70,
      sorter: (a: Order, b: Order) => a.dlvDate.localeCompare(b.dlvDate),
      render: (val: string) => (
        <Text strong type={isOverdue(val) ? 'danger' : 'warning'} style={{ fontSize: 11 }}>
          {val ? dayjs(val).format('MM-DD') : '-'}
        </Text>
      ),
    },
    {
      title: '客户',
      dataIndex: 'keyAccount',
      key: 'keyAccount',
      width: 75,
      ellipsis: true,
      render: (val: string) =>
        val ? <Tag color="blue" style={{ fontSize: 10 }}>{val}</Tag> : <Text type="secondary">-</Text>,
    },
    {
      title: '状态',
      dataIndex: 'prodStatus',
      key: 'prodStatus',
      width: 70,
      ellipsis: true,
      render: (val: string) => <Text type="secondary" style={{ fontSize: 10 }}>{val || '-'}</Text>,
    },
    {
      title: '生产池',
      dataIndex: 'prodPoolId',
      key: 'prodPoolId',
      width: 65,
      ellipsis: true,
      render: (val: string) =>
        val ? <Tag color="geekblue" style={{ fontSize: 9 }}>{val}</Tag> : <Text type="secondary">-</Text>,
    },
  ];

  const sc           = runResult?.scheduledCount ?? 0;
  const ec           = runResult?.exceptionCount ?? 0;
  const exceptions   = runResult?.exceptions || [];
  const blockerCount = exceptions.filter((e: any) => e.severity === 'BLOCKER').length;
  const warningCount = exceptions.filter((e: any) => e.severity === 'WARNING').length;

  // ============================================================================
  // 渲染
  // ============================================================================
  return (
    <div style={{ padding: 24, backgroundColor: '#fff', borderRadius: 8 }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>

        {/* ─── 页头 ─────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <Space align="center" size={8}>
              <Title level={4} style={{ margin: 0 }}>ESG 排产</Title>
              <Tag color="cyan" style={{ fontSize: 12 }}>ESG</Tag>
            </Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              筛选并勾选参与排产的订单 · 每次执行前清空所有旧结果，写入全新快照
            </Text>
          </div>
          {lastRun && (
            <Card size="small" style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8 }}>
              <Space size={8} wrap>
                <Text type="secondary" style={{ fontSize: 11 }}>上次排产</Text>
                <Text style={{ fontSize: 11, fontWeight: 600 }}>
                  {dayjs(lastRun.runTime).format('MM-DD HH:mm')}
                </Text>
                <Tag
                  color={lastRun.runMode === 'SELECTED' ? 'blue' : 'orange'}
                  style={{ fontSize: 10, margin: 0 }}
                >
                  {lastRun.runMode === 'SELECTED' ? '选中' : '全量'}
                </Tag>
                <Text style={{ fontSize: 11 }}>
                  排产 <strong>{lastRun.scheduledCount}</strong> 条
                </Text>
                {lastRun.exceptionCount > 0 && (
                  <Tag color="warning" style={{ fontSize: 10, margin: 0 }}>
                    异常 {lastRun.exceptionCount}
                  </Tag>
                )}
              </Space>
            </Card>
          )}
        </div>

        {/* ─── 一体化操作栏 ─────────────────────────────── */}
        <Card size="small" style={{ borderRadius: 8 }} bodyStyle={{ padding: '12px 16px' }}>
          {/* 第一行：筛选条件 */}
          <Space size={16} wrap align="center">
            <Space size={6}>
              <Text style={{ fontSize: 13, whiteSpace: 'nowrap' }}>交期范围</Text>
              <RangePicker
                size="small"
                format="YYYY-MM-DD"
                value={dlvDateRange}
                onChange={(vals: any) => setDlvDateRange(vals)}
                style={{ width: 220 }}
              />
            </Space>
            <Space size={6}>
              <Text style={{ fontSize: 13, whiteSpace: 'nowrap' }}>客户</Text>
              <Select
                size="small"
                allowClear
                placeholder="全部客户"
                value={keyAccountFilter}
                onChange={setKeyAccountFilter}
                options={customerOptions}
                style={{ width: 160 }}
              />
            </Space>
            <Tooltip title="按当前筛选条件重新加载订单列表">
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => {
                  setCurrentPage(1);
                  loadOrders(1, pageSize);
                }}
                loading={loadingOrders}
              >
                刷新
              </Button>
            </Tooltip>
          </Space>

          <Divider style={{ margin: '10px 0' }} />

          {/* 第二行：勾选操作 + 执行按钮 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <Space size={8}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                共 <strong>{total}</strong> 条
                {overdueCount > 0 && (
                  <Tag color="red" style={{ fontSize: 10, marginLeft: 6 }}>逾期 {overdueCount}</Tag>
                )}
              </Text>
              {selectedCount > 0 && (
                <Tag color="blue" style={{ fontSize: 11 }}>已选 {selectedCount} 条</Tag>
              )}
              <Button size="small" onClick={() => setSelectedRowKeys(allOrders.map(o => o.prodId))} disabled={allOrders.length === 0}>
                全选
              </Button>
              <Button size="small" onClick={() => setSelectedRowKeys([])} disabled={selectedCount === 0}>
                清除选择
              </Button>
            </Space>

            <Space size={8}>
              <Space size={6}>
                <Text style={{ fontSize: 13, whiteSpace: 'nowrap' }}>开工日期</Text>
                <DatePicker
                  size="small"
                  format="YYYY-MM-DD"
                  value={schedStartDate}
                  onChange={(val: any) => setSchedStartDate(val || dayjs())}
                  allowClear={false}
                  style={{ width: 130 }}
                />
              </Space>
              <Button
                type="primary"
                danger={isFullMode}
                icon={<PlayCircleOutlined />}
                onClick={handleRun}
                loading={running}
              >
                {selectedCount > 0 ? `▶ 执行 ESG 排产（${selectedCount} 条）` : '▶ 执行 ESG 全量排产'}
              </Button>
            </Space>
          </div>
        </Card>

        {/* ─── 订单列表（后端分页）──────────────────────── */}
        <Table
          size="small"
          rowKey="prodId"
          columns={columns}
          dataSource={allOrders}
          loading={loadingOrders}
          rowSelection={{
            type: 'checkbox',
            selectedRowKeys,
            onChange: keys => setSelectedRowKeys(keys),
            preserveSelectedRowKeys: true,
          }}
          rowClassName={(record: Order) => isOverdue(record.dlvDate) ? 'order-row-overdue' : ''}
          pagination={{
            current: currentPage,
            pageSize,
            total,
            pageSizeOptions: ['20', '50', '100'],
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
            onChange: (page, size) => {
              setCurrentPage(page);
              setPageSize(size);
              loadOrders(page, size);
            },
          }}
          scroll={{ x: 'max-content' }}
        />

      </Space>

      {/* ─── 排产完成结果 Modal ───────────────────────────── */}
      <Modal
        title={
          <Space>
            {ec === 0
              ? <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 18 }} />
              : <WarningOutlined style={{ color: '#faad14', fontSize: 18 }} />}
            <span>ESG 排产完成</span>
          </Space>
        }
        open={resultOpen}
        onCancel={() => setResultOpen(false)}
        footer={[
          ec > 0 && (
            <Button key="exc" onClick={() => { setResultOpen(false); setExceptionOpen(true); }}>
              查看异常详情
            </Button>
          ),
          ganttPath && (
            <Button
              key="gantt"
              type="primary"
              icon={<ArrowRightOutlined />}
              onClick={() => { setResultOpen(false); navigate(ganttPath); }}
            >
              前往排产看板
            </Button>
          ),
          <Button key="close" onClick={() => setResultOpen(false)}>关闭</Button>,
        ].filter(Boolean)}
        width={520}
        centered
      >
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <Row gutter={12}>
            {[
              { title: '总订单数', value: runResult?.totalOrders || 0,  icon: <InfoCircleOutlined />,  color: undefined },
              { title: '排产成功', value: sc,                            icon: <CheckCircleOutlined />, color: '#1677ff' },
              { title: '异常订单', value: ec,                            icon: <WarningOutlined />,     color: ec > 0 ? '#faad14' : '#3f8600' },
              {
                title: '成功率',
                value: runResult?.totalOrders ? ((sc / runResult.totalOrders) * 100).toFixed(0) + '%' : '-',
                icon: <CheckCircleOutlined />,
                color: '#3f8600',
              },
            ].map(item => (
              <Col span={6} key={item.title}>
                <Card size="small" style={{ textAlign: 'center', borderRadius: 8 }}>
                  <Statistic
                    title={<span style={{ fontSize: 11 }}>{item.title}</span>}
                    value={item.value}
                    prefix={item.icon}
                    valueStyle={{ fontSize: 20, ...(item.color ? { color: item.color } : {}) }}
                  />
                </Card>
              </Col>
            ))}
          </Row>

          {/* BLOCKER 异常：真正排产失败 */}
          {blockerCount > 0 && (
            <Alert
              type="error"
              showIcon
              message={`${blockerCount} 条订单排产失败（BLOCKER）`}
              description="无工艺路线或无有效产线，这些订单未写入排产结果，请联系工程团队补录路线数据。"
            />
          )}

          {/* WARNING 跳过：池子不在白名单，属于业务预期 */}
          {warningCount > 0 && (
            <Alert
              type="warning"
              showIcon
              message={`${warningCount} 条订单已跳过（仅供参考）`}
              description="这些订单所在生产池（如 Tooling / Bond Book 类）不属于装配排产范围，系统已自动排除，不影响排产结果。"
            />
          )}

          {/* 全部成功 */}
          {ec === 0 && (
            <Alert
              type="success"
              showIcon
              message={`✅ 全部 ${sc} 条排产成功，可前往「排产看板」查看甘特图。`}
            />
          )}
        </Space>
      </Modal>

      {/* ─── 异常详情 Modal ───────────────────────────────── */}
      <Modal
        title={
          <Space>
            <WarningOutlined style={{ color: '#faad14' }} />
            <span>排产异常明细（{exceptions.length} 条）</span>
            {blockerCount > 0 && <Tag color="red">BLOCKER {blockerCount}</Tag>}
            {warningCount > 0 && <Tag color="orange">跳过 {warningCount}</Tag>}
          </Space>
        }
        open={exceptionOpen}
        onCancel={() => setExceptionOpen(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setExceptionOpen(false)}>知道了</Button>,
        ]}
        width={700}
      >
        <Table
          size="small"
          rowKey={(r: any, idx: any) => `${r.prodId}_${r.exceptionType}_${idx}`}
          dataSource={runResult?.exceptions || []}
          columns={[
            { title: '生产单号',  dataIndex: 'prodId',        width: 140 },
            { title: '物料',      dataIndex: 'itemId',        width: 110 },
            {
              title: '严重度', dataIndex: 'severity', width: 80,
              render: (v: string) => (
                <Tag color={v === 'BLOCKER' ? 'red' : 'orange'} style={{ fontSize: 10 }}>{v}</Tag>
              ),
            },
            {
              title: '异常类型', dataIndex: 'exceptionType', width: 160,
              render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text>,
            },
            {
              title: '说明', dataIndex: 'message', ellipsis: true,
              render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text>,
            },
          ]}
          pagination={false}
          scroll={{ y: 360 }}
        />
        <div style={{ marginTop: 12, padding: '8px 12px', background: '#fffbe6', borderRadius: 6, fontSize: 12, color: '#614700', lineHeight: 1.6 }}>
          ℹ <strong>BLOCKER</strong> — 订单未参与排产（如缺少工艺路线、数量为0等）<br />
          ℹ <strong>WARNING</strong> — 订单已排产（如交期已逾期，系统以最高优先级处理）
        </div>
      </Modal>

      {/* 逾期行样式 */}
      <style>{`
        .order-row-overdue > td { background-color: #fff2f0 !important; }
        .order-row-overdue:hover > td { background-color: #ffeded !important; }
      `}</style>
    </div>
  );
};

export default SchedulingOrderSelector;
