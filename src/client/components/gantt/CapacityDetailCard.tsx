import React from 'react';
import { Tag, Typography, Space, Descriptions } from 'antd';
import { formatNum, dayjs } from './utils';

const { Text } = Typography;

/**
 * 甘特格悬浮量能明细卡片
 *
 * 展示某天的排产详情：总量、标准/加班拆分、工时、人力、UPH 等。
 */
export const CapacityDetailCard: React.FC<{
  date: string;
  detail: any;
  isGlobalRest: boolean;
}> = ({ date, detail, isGlobalRest }) => {
  if (!detail) {
    return (
      <div style={{ padding: '8px 4px' }}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          {isGlobalRest ? '休息日 / 无排产计划' : '当日无排产明细'}
        </Text>
      </div>
    );
  }

  const getDayTypeTag = (type: string) => {
    switch (type) {
      case 'WORKDAY':     return <Tag color="green"   style={{ margin: 0, border: 'none' }}>工作日</Tag>;
      case 'OVERTIME':    return <Tag color="orange"  style={{ margin: 0, border: 'none' }}>加班日</Tag>;
      case 'WEEKEND':     return <Tag color="default" style={{ margin: 0, border: 'none' }}>周末/假</Tag>;
      case 'HOLIDAY':     return <Tag color="magenta" style={{ margin: 0, border: 'none' }}>法定节假日</Tag>;
      case 'MAINTENANCE': return <Tag color="purple"  style={{ margin: 0, border: 'none' }}>设备保养</Tag>;
      default:            return <Tag color="blue"    style={{ margin: 0, border: 'none' }}>{type || '未知'}</Tag>;
    }
  };

  const hasProductionTask =
    formatNum(detail.totalQty) > 0 || formatNum(detail.effectiveHours, 2) > 0;

  return (
    <div style={{ width: 270 }}>
      {/* 日期 + 类型标签头部 */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        paddingBottom: 12, marginBottom: 16, borderBottom: '1px solid #f0f0f0',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <Text strong style={{ fontSize: 16 }}>{date}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {detail.dayLabel || dayjs(date).format('dddd')}
          </Text>
        </div>
        {getDayTypeTag(detail.dayType)}
      </div>

      {!hasProductionTask ? (
        <Text type="secondary" style={{ fontSize: 13 }}>当日无排班或生产任务</Text>
      ) : (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {/* 总排产数量块 */}
          <div style={{
            backgroundColor: '#fafafa', padding: '14px 16px',
            borderRadius: 8, border: '1px solid #f0f0f0',
          }}>
            <div style={{ marginBottom: 6 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>总排产 (PCS)</Text>
            </div>
            <div style={{ fontSize: 26, fontWeight: '900', color: '#1677ff', lineHeight: 1 }}>
              {formatNum(detail.totalQty)}
            </div>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              marginTop: 12, fontSize: 12,
              borderTop: '1px dashed #e8e8e8', paddingTop: 10,
            }}>
              <Text type="secondary">
                标准:{' '}
                <Text strong style={{ color: 'rgba(0,0,0,0.88)', fontSize: 13 }}>
                  {formatNum(detail.standardQty)}
                </Text>
              </Text>
              <Text type="secondary">
                加班:{' '}
                <Text
                  strong
                  type={formatNum(detail.overtimeQty) > 0 ? 'warning' : 'secondary'}
                  style={{ fontSize: 13 }}
                >
                  {formatNum(detail.overtimeQty)}
                </Text>
              </Text>
            </div>
          </div>

          {/* 工时 / 人力 / UPH 明细 */}
          <Descriptions size="small" column={2} layout="vertical" colon={false} style={{ margin: 0 }}>
            <Descriptions.Item
              label={<Text type="secondary" style={{ fontSize: 12 }}>计划总耗时</Text>}
              style={{ paddingBottom: 8 }}
            >
              <Text strong>
                {formatNum(
                  (Number(detail.effectiveHours) || 0) +
                  (Number(detail.overtimeHours)  || 0) +
                  (Number(detail.setupHours)     || 0),
                  2,
                )}h
              </Text>
              {formatNum(detail.setupHours, 2) > 0 && (
                <span style={{ fontSize: 12, color: '#ff4d4f', marginLeft: 4 }}>
                  (-{formatNum(detail.setupHours, 2)}h)
                </span>
              )}
            </Descriptions.Item>

            <Descriptions.Item
              label={<Text type="secondary" style={{ fontSize: 12 }}>实际人力</Text>}
              style={{ paddingBottom: 8 }}
            >
              <Text strong>{formatNum(detail.actualHeadcount)}人</Text>
              {formatNum(detail.actualHeadcount) > formatNum(detail.headcount) && (
                <Tag color="warning" bordered={false} style={{ marginLeft: 4, padding: '0 4px', fontSize: 10 }}>
                  借调
                </Tag>
              )}
            </Descriptions.Item>

            <Descriptions.Item
              label={<Text type="secondary" style={{ fontSize: 12 }}>有效 UPH</Text>}
              style={{ paddingBottom: 0 }}
            >
              <Text strong>{formatNum(detail.effectiveUph, 2) || '-'}</Text>
            </Descriptions.Item>

            <Descriptions.Item
              label={<Text type="secondary" style={{ fontSize: 12 }}>单人 UPH</Text>}
              style={{ paddingBottom: 0 }}
            >
              <Text strong>{formatNum(detail.perPersonUph, 2) || '-'}</Text>
            </Descriptions.Item>
          </Descriptions>
        </Space>
      )}
    </div>
  );
};
