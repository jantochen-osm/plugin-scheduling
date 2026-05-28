// @ts-nocheck
import {
  BlockModel,
  ActionModel,
  ActionSceneEnum,
  Plugin,
} from '@nocobase/client';
import { ButtonProps, Button, Space, Card, Statistic, Row, Col, Alert, Spin } from 'antd';
import {
  PlayCircleOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import React, { useState } from 'react';
import { SchedulingDashboard } from './pages/SchedulingDashboard';

// ============================================================
// 排产面板子组件
// ============================================================
function SchedulingPanel({ api }: { api: any }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<string>('ESG'); // ESG | EE | ''

  const handleRun = () => {
    if (!api) { setError('No API client'); return; }
    setLoading(true);
    setError(null);
    const params: any = {};
    if (strategy) params.strategy = strategy;
    api.resource('scheduling').run({ values: params })
      .then((res: any) => {
        setResult(res?.data?.data || res?.data || {});
      })
      .catch((e: any) => {
        setError(e.message || 'Scheduling failed');
      })
      .finally(() => setLoading(false));
  };

  const sc = result?.scheduledCount ?? 0;
  const ec = result?.exceptionCount ?? 0;

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <h3 style={{ margin: 0 }}>OSM Scheduling Engine</h3>
          <p style={{ margin: '4px 0 0', color: '#8c8c8c' }}>
            EE (3F3~6) / ESG (4F1~6)
          </p>
        </div>

        {/* Strategy selector */}
        <Space>
          {['ESG', 'EE', ''].map(s => (
            <Button
              key={s || 'ALL'}
              type={strategy === s ? 'primary' : 'default'}
              size="small"
              onClick={() => setStrategy(s)}
            >
              {s || 'EE+ESG'}
            </Button>
          ))}
        </Space>

        <Button
          type="primary"
          icon={loading ? undefined : <PlayCircleOutlined />}
          onClick={handleRun}
          loading={loading}
          size="large"
        >
          Run Scheduling
        </Button>

        {error && (
          <Alert type="error" message={error} showIcon closable onClose={() => setError(null)} />
        )}

        {loading && (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin tip="Scheduling..." />
          </div>
        )}

        {result && !loading && (
          <>
            <Row gutter={16}>
              <Col span={6}>
                <Card size="small">
                  <Statistic title="Total Orders" value={result.totalOrders || 0} />
                </Card>
              </Col>
              <Col span={6}>
                <Card size="small">
                  <Statistic
                    title="Scheduled"
                    value={sc}
                    prefix={<CheckCircleOutlined />}
                    valueStyle={{ color: '#1677ff' }}
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card size="small">
                  <Statistic
                    title="Exceptions"
                    value={ec}
                    prefix={<WarningOutlined />}
                    valueStyle={{ color: ec > 0 ? '#faad14' : '#3f8600' }}
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card size="small">
                  <Statistic
                    title="Rate"
                    value={result.totalOrders ? ((sc / result.totalOrders) * 100).toFixed(0) + '%' : '-'}
                    valueStyle={{ color: '#3f8600' }}
                  />
                </Card>
              </Col>
            </Row>

            {/* Line utilization */}
            {result.lineUtilization?.length > 0 && (
              <Card size="small" title="Line Utilization">
                {result.lineUtilization.map((lu: any) => (
                  <div key={lu.line} style={{ marginBottom: 4 }}>
                    <span style={{ fontWeight: 600 }}>{lu.line}</span>
                    : {lu.usedHours}/{lu.totalCapacityHours}h ({lu.utilizationRate}%)
                    · {lu.orderCount} orders
                  </div>
                ))}
              </Card>
            )}

            {sc > 0 && (
              <Alert
                type="success"
                message={`Done: ${sc} results · ${ec} exceptions · Strategies: ${result.strategies?.join(', ') || '-'}`}
                showIcon
              />
            )}

            <Button icon={<ReloadOutlined />} onClick={handleRun}>Re-run</Button>
          </>
        )}
      </Space>
    </div>
  );
}

// ============================================================
// Block: 排产面板
// ============================================================
class SchedulingBlockModel extends BlockModel {
  renderComponent() {
    const api = (this as any).context?.api;
    return <SchedulingPanel api={api} />;
  }
}

// ============================================================
// Action: 工具栏执行排产按钮
// ============================================================
class RunSchedulingActionModel extends ActionModel {
  static scene = ActionSceneEnum.collection;

  defaultProps: ButtonProps = {
    type: 'primary',
    title: '执行排产',
  };
}

// ============================================================
// Block: 排产看板（全局日期轴方案A）
// ============================================================
class SchedulingDashboardModel extends BlockModel {
  renderComponent() {
    return React.createElement(SchedulingDashboard);
  }
}

// ============================================================
// Field: dailyPlan 可视化
// ============================================================
function DailyPlanField(props: any) {
  const value = props.value as Record<string, number> | null;
  if (!value || Object.keys(value).length === 0) {
    return <span style={{ color: '#bfbfbf' }}>-</span>;
  }
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  const totalQty = entries.reduce((sum, [, qty]) => sum + qty, 0);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center' }}>
      {entries.map(([date, qty]) => {
        const dayLabel = date.slice(5);
        const intensity = Math.min(1, qty / 10000);
        const r = Math.round(36 + (24 - 36) * intensity);
        const g = Math.round(144 + (144 - 144) * intensity);
        const b = Math.round(238 + (220 - 238) * intensity);
        return (
          <div
            key={date}
            title={`${date}: ${qty.toLocaleString()}`}
            style={{
              width: 22, height: 22, borderRadius: 3,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 600, cursor: 'default',
              backgroundColor: `rgb(${r}, ${g}, ${b})`,
              color: intensity > 0.5 ? '#fff' : '#1d1d1d',
            }}
          >
            {dayLabel}
          </div>
        );
      })}
      <span style={{ fontSize: 11, color: '#8c8c8c', marginLeft: 4 }}>
        {entries.length}d / {totalQty.toLocaleString()}
      </span>
    </div>
  );
}

// ============================================================
// Plugin 入口
// ============================================================
export class PluginSchedulingClient extends Plugin {
  async load() {
    // 注册组件
    this.app.addComponents({ DailyPlanField });

    // 注册 flow-engine models
    this.flowEngine.registerModels({
      SchedulingBlockModel,
      RunSchedulingActionModel,
      SchedulingDashboardModel,  // 新增：排产看板
    });
  }
}

export default PluginSchedulingClient;
