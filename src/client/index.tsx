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

// ============================================================
// 排产面板子组件（用 hooks 管理状态）
// ============================================================
function SchedulingPanel({ api }: { api: any }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = () => {
    if (!api) {
      setError('无法获取 API 客户端');
      return;
    }
    setLoading(true);
    setError(null);
    api.resource('scheduling').run()
      .then((res: any) => {
        setResult(res?.data?.data || res?.data || {});
      })
      .catch((e: any) => {
        setError(e.message || '排产失败');
      })
      .finally(() => setLoading(false));
  };

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <h3 style={{ margin: 0 }}>OSM 排产引擎</h3>
          <p style={{ margin: '4px 0 0', color: '#8c8c8c' }}>EE Assembly 3F3~3F6 MVP</p>
        </div>

        <Button
          type="primary"
          icon={loading ? undefined : <PlayCircleOutlined />}
          onClick={handleRun}
          loading={loading}
          size="large"
        >
          执行排产
        </Button>

        {error && (
          <Alert type="error" message={error} showIcon closable onClose={() => setError(null)} />
        )}

        {loading && (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin tip="排产中..." />
          </div>
        )}

        {result && !loading && (
          <>
            <Row gutter={16}>
              <Col span={6}>
                <Card size="small">
                  <Statistic title="总订单" value={result.totalOrders || 0} />
                </Card>
              </Col>
              <Col span={6}>
                <Card size="small">
                  <Statistic
                    title="有效订单"
                    value={result.validOrders || 0}
                    valueStyle={{ color: '#3f8600' }}
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card size="small">
                  <Statistic
                    title="排产结果"
                    value={result.results || 0}
                    prefix={<CheckCircleOutlined />}
                    valueStyle={{ color: '#1677ff' }}
                  />
                </Card>
              </Col>
              <Col span={6}>
                <Card size="small">
                  <Statistic
                    title="异常"
                    value={result.exceptions || 0}
                    prefix={<WarningOutlined />}
                    valueStyle={{ color: (result.exceptions || 0) > 0 ? '#faad14' : '#3f8600' }}
                  />
                </Card>
              </Col>
            </Row>

            {(result.results > 0) && (
              <Alert
                type="success"
                message={`排产完成: ${result.results} 条结果 · 成功率 ${((result.results / Math.max(1, result.validOrders)) * 100).toFixed(0)}%`}
                showIcon
              />
            )}

            <Button icon={<ReloadOutlined />} onClick={handleRun}>重新排产</Button>
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
    });
  }
}

export default PluginSchedulingClient;
