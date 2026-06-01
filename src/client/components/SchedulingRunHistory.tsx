import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, Tag, Typography, Space, Button, Card,
} from 'antd';
import { ReloadOutlined, CheckCircleOutlined, WarningOutlined } from '@ant-design/icons';
import * as _dayjs from 'dayjs';
const dayjs: any = _dayjs;
const { Text, Title } = Typography;

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
  exceptionBreakdown: any; // { summary: Record<string,number>, details: ExcDetail[] } | Record<string,number> | null
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
              每次排产运行记录 · 点击行展开异常明细
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
    </div>
  );
};

export default SchedulingRunHistory;
