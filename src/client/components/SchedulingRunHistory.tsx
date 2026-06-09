import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, Tag, Typography, Space, Button, Card, Drawer, Popconfirm, message,
} from 'antd';
import { ReloadOutlined, CheckCircleOutlined, WarningOutlined, BarChartOutlined } from '@ant-design/icons';
import * as _dayjs from 'dayjs';
const dayjs: any = _dayjs;
const { Text, Title } = Typography;
import SchedulingGantt from './SchedulingGantt';

// ============================================================================
// 类型
// ============================================================================
interface RunRecord {
  runId: string;
  runTime: string;
  status: string;
  runMode: string;
  totalOrders: number;
  scheduledCount: number;
  exceptionCount: number;
  successRate: number;
  selectedProdIds: string | null;
  exceptionBreakdown: any;
  strategy: string;       // 新增
  startDate: string;      // 新增
  versionName: string;    // 新增
}

interface ExcDetail {
  prodId: string;
  itemId: string;
  exceptionType: string;
  severity: string;
  message: string;
}

// ============================================================================
// 工具
// ============================================================================
function parseSelectedCount(selectedProdIds: string | null): number {
  try {
    if (!selectedProdIds) return 0;
    const arr = typeof selectedProdIds === 'string' ? JSON.parse(selectedProdIds) : selectedProdIds;
    return Array.isArray(arr) ? arr.length : 0;
  } catch { return 0; }
}

/** 解析 exceptionBreakdown，兼容新旧两种格式 */
function parseBreakdown(raw: any): { summary: Record<string, number>; details: ExcDetail[] } {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed) return { summary: {}, details: [] };

    // 新格式：{ summary: {...}, details: [...] }
    if (parsed.summary !== undefined || parsed.details !== undefined) {
      return {
        summary: parsed.summary || {},
        details: Array.isArray(parsed.details) ? parsed.details : [],
      };
    }

    // 旧格式：{ TYPE: count }
    return { summary: parsed as Record<string, number>, details: [] };
  } catch {
    return { summary: {}, details: [] };
  }
}

// ============================================================================
// 主组件
// ============================================================================
const SchedulingRunHistory: React.FC<{ api: any }> = ({ api }) => {
  const [records, setRecords]     = useState<RunRecord[]>([]);
  const [loading, setLoading]     = useState(false);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [pageSize, setPageSize]   = useState(10);

  // 版本管理 state
  const [ganttOpen,       setGanttOpen]       = useState(false);
  const [selectedRunId,   setSelectedRunId]   = useState<string | null>(null);
  const [deletingRunId,   setDeletingRunId]   = useState<string | null>(null);

  const fetchHistory = useCallback(async (p = page, ps = pageSize) => {
    setLoading(true);
    try {
      const res = await api.request({
        url: 'scheduling:listRuns',
        method: 'get',
        params: { page: p, pageSize: ps },
      });
      const body = res?.data?.data || res?.data || {};
      setRecords(body.data || []);
      setTotal(body.meta?.total || 0);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [api, page, pageSize]);

  useEffect(() => { fetchHistory(); }, []);

  // 删除指定版本
  const handleDeleteVersion = useCallback(async (runId: string) => {
    setDeletingRunId(runId);
    try {
      await api.request({
        url: 'scheduling:deleteVersion',
        method: 'post',
        data: { runId },
      });
      message.success('已删除该版本排产结果');
      fetchHistory(page, pageSize);
    } catch (e: any) {
      message.error('删除失败：' + (e?.message || '未知错误'));
    } finally {
      setDeletingRunId(null);
    }
  }, [api, fetchHistory, page, pageSize]);

  // ── 列定义 ──────────────────────────────────────────────────────────────
  const columns = [
    {
      title: '运行时间',
      dataIndex: 'runTime',
      key: 'runTime',
      width: 140,
      render: (v: string) => (
        <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>
          {v ? dayjs(v).format('MM-DD HH:mm:ss') : '-'}
        </Text>
      ),
    },
    {
      title: '模式',
      dataIndex: 'runMode',
      key: 'runMode',
      width: 110,
      render: (mode: string, record: RunRecord) => {
        const cnt = parseSelectedCount(record.selectedProdIds);
        return mode === 'SELECTED'
          ? <Tag color="blue" style={{ fontSize: 11 }}>选中 {cnt} 条</Tag>
          : <Tag color="orange" style={{ fontSize: 11 }}>全量</Tag>;
      },
    },
    {
      title: '排产数',
      dataIndex: 'scheduledCount',
      key: 'scheduledCount',
      width: 80,
      align: 'right' as const,
      render: (v: number) => (
        <Text strong style={{ color: '#1677ff' }}>{v ?? '-'}</Text>
      ),
    },
    {
      title: '异常数',
      dataIndex: 'exceptionCount',
      key: 'exceptionCount',
      width: 80,
      align: 'right' as const,
      render: (v: number) =>
        v > 0
          ? <Tag color="warning" style={{ fontSize: 11 }}>{v}</Tag>
          : <Text type="secondary">0</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (v: string) =>
        v === 'SUCCESS'
          ? <Space size={4}><CheckCircleOutlined style={{ color: '#52c41a' }} /><Text style={{ fontSize: 12, color: '#52c41a' }}>成功</Text></Space>
          : <Space size={4}><WarningOutlined style={{ color: '#faad14' }} /><Text style={{ fontSize: 12, color: '#faad14' }}>部分</Text></Space>,
    },
    {
      title: '总订单',
      dataIndex: 'totalOrders',
      key: 'totalOrders',
      width: 75,
      align: 'right' as const,
      render: (v: number) => <Text type="secondary" style={{ fontSize: 12 }}>{v ?? '-'}</Text>,
    },
    {
      title: '策略',
      dataIndex: 'strategy',
      key: 'strategy',
      width: 70,
      render: (v: string) => {
        const colorMap: Record<string, string> = { ESG: 'cyan', EE: 'blue', ALL: 'green' };
        return v ? <Tag color={colorMap[v] || 'default'} style={{ fontSize: 11 }}>{v}</Tag>
                 : <Text type="secondary">-</Text>;
      },
    },
    {
      title: '开工日期',
      dataIndex: 'startDate',
      key: 'startDate',
      width: 95,
      render: (v: string) => <Text style={{ fontSize: 12 }}>{v || '-'}</Text>,
    },
    // ── 版本管理操作列 ──────────────────────────────────────────────────────
    {
      title: '操作',
      key: 'action',
      width: 180,
      fixed: 'right' as const,
      render: (_: any, record: RunRecord) => (
        <Space size={6}>
          <Button
            size="small"
            type="primary"
            ghost
            icon={<BarChartOutlined />}
            onClick={() => { setSelectedRunId(record.runId); setGanttOpen(true); }}
          >
            查看甘特图
          </Button>
          <Popconfirm
            title="确认删除此版本排产结果？操作不可恢复"
            onConfirm={() => handleDeleteVersion(record.runId)}
            okText="删除" okButtonProps={{ danger: true }}
            cancelText="取消"
          >
            <Button
              size="small"
              danger
              loading={deletingRunId === record.runId}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const expandedRowRender = (record: RunRecord) => {
    const { summary, details } = parseBreakdown(record.exceptionBreakdown);
    const summaryEntries = Object.entries(summary);

    if (summaryEntries.length === 0 && details.length === 0) {
      return (
        <div style={{ padding: '8px 16px' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>本次排产无异常 ✅</Text>
        </div>
      );
    }

    return (
      <div style={{ padding: '8px 16px 12px' }}>
        {/* 明细表格（新格式） */}
        {details.length > 0 && (
          <>
            <Text style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, display: 'block' }}>
              异常明细（{details.length} 条）
            </Text>
            <Table
              size="small"
              rowKey={(r, i) => `${r.prodId}_${i}`}
              dataSource={details}
              pagination={details.length > 10 ? { pageSize: 10, size: 'small' } : false}
              columns={[
                {
                  title: '严重度',
                  dataIndex: 'severity',
                  width: 80,
                  render: (v: string) => (
                    <Tag
                      color={v === 'BLOCKER' ? 'red' : 'orange'}
                      style={{ fontSize: 10, margin: 0 }}
                    >
                      {v}
                    </Tag>
                  ),
                },
                {
                  title: '生产单号',
                  dataIndex: 'prodId',
                  width: 140,
                  render: (v: string) => <Text style={{ fontSize: 12 }}>{v || '-'}</Text>,
                },
                {
                  title: '物料',
                  dataIndex: 'itemId',
                  width: 120,
                  render: (v: string) => <Text style={{ fontSize: 12 }}>{v || '-'}</Text>,
                },
                {
                  title: '异常类型',
                  dataIndex: 'exceptionType',
                  width: 150,
                  render: (v: string) => <Text style={{ fontSize: 12 }}>{v || '-'}</Text>,
                },
                {
                  title: '原因说明',
                  dataIndex: 'message',
                  ellipsis: true,
                  render: (v: string) => (
                    <Text type="secondary" style={{ fontSize: 12 }}>{v || '-'}</Text>
                  ),
                },
              ]}
              style={{ marginBottom: 8 }}
            />
            {/* 汇总行 */}
            <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 4 }}>
              {summaryEntries.map(([type, count]) => (
                <Tag key={type} color="default" style={{ fontSize: 10 }}>
                  {type}: {count}
                </Tag>
              ))}
            </div>
          </>
        )}

        {/* 旧格式兼容：只有计数没有明细 */}
        {details.length === 0 && summaryEntries.length > 0 && (
          <div>
            <Text type="secondary" style={{ fontSize: 12, marginBottom: 6, display: 'block' }}>
              异常类型汇总（旧数据，均无订单明细）：
            </Text>
            <Space size={6} wrap>
              {summaryEntries.map(([type, count]) => (
                <Tag key={type} color="warning" style={{ fontSize: 11 }}>
                  {type}: {count}
                </Tag>
              ))}
            </Space>
          </div>
        )}
      </div>
    );
  };

  // ============================================================================
  // 渲染
  // ============================================================================
  return (
    <div style={{ padding: 24, backgroundColor: '#fff', borderRadius: 8 }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>

        {/* 页头 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Title level={4} style={{ margin: 0 }}>排产历史</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              每次排产运行记录 · 点击「查看甘特图」可查看并修改该版本排产，展开行可查异常明细
            </Text>
          </div>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => fetchHistory(page, pageSize)}
          >
            刷新
          </Button>
        </div>

        {/* 历史列表 */}
        <Card size="small" style={{ borderRadius: 8 }} bodyStyle={{ padding: 0 }}>
          <Table
            size="small"
            rowKey="runId"
            columns={columns}
            dataSource={records}
            loading={loading}
            expandable={{
              expandedRowRender,
              rowExpandable: () => true,
            }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: ['10', '20', '50'],
              showTotal: (t, range) => `第 ${range[0]}-${range[1]} 条，共 ${t} 条`,
              onChange: (p, ps) => {
                setPage(p);
                setPageSize(ps);
                fetchHistory(p, ps);
              },
            }}
          />
        </Card>

      </Space>

      {/* 版本甘特图 Drawer */}
      <Drawer
        title={
          <Space>
            <span>排产甘特图</span>
            {selectedRunId && (
              <Tag color="blue" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                {selectedRunId}
              </Tag>
            )}
          </Space>
        }
        open={ganttOpen}
        onClose={() => { setGanttOpen(false); setSelectedRunId(null); }}
        width="95vw"
        placement="right"
        destroyOnClose
        styles={{ body: { padding: 0 } }}
      >
        {selectedRunId && (
          <SchedulingGantt api={api} runId={selectedRunId} />
        )}
      </Drawer>
    </div>
  );
};

export default SchedulingRunHistory;
