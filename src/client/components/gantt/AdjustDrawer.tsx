import React, { useState, useEffect } from 'react';
import {
  Drawer, Form, Select, DatePicker, InputNumber, Input,
  Alert, Divider, Space, Button, Tag, Typography, Tooltip,
  Switch, Popconfirm, Modal, message,
} from 'antd';
import { formatNum, dayjs } from './utils';
import { useCalcDailyPlan } from './useCalcDailyPlan';

const { Text } = Typography;

interface AdjustDrawerProps {
  open: boolean;
  record: any;
  onClose: () => void;
  onSaved: () => void;
  api: any;
}

/**
 * AdjustDrawer — 调整排产结果抽屉
 *
 * 功能：
 *  - 修改开始/完成日期、换产线、填写备注
 *  - 手动编辑每日产量（增删改）
 *  - 「按日期计算」一键按满产能力分配（开始日期视为开工时间）
 *  - 保存前校验日期一致性（与每日列表不一致时提示确认）
 *  - 保存后可选触发重算
 *  - 已调整记录可解锁
 */

// ESG 产线列表降级值
const ESG_LINES_FALLBACK = ['4F1', '4F2', '4F4', '4F6'];

export const AdjustDrawer: React.FC<AdjustDrawerProps> = ({
  open, record, onClose, onSaved, api,
}) => {
  const [form] = Form.useForm();
  const [loading,       setLoading]       = useState(false);
  const [patchMap,      setPatchMap]      = useState<Record<string, number>>({});
  const [addedDates,    setAddedDates]    = useState<Set<string>>(new Set());
  const [newDateInput,  setNewDateInput]  = useState<any>(null);
  const [newQtyInput,   setNewQtyInput]   = useState(0);
  const [showAddRow,    setShowAddRow]    = useState(false);
  const [sortDir,       setSortDir]       = useState<'asc' | 'desc'>('asc');
  const [autoReSchedule, setAutoReSchedule] = useState(false);
  /** 标记哪些日期是「按日期计算」自动生成的（用于展示「自动」tag） */
  const [autoDates,     setAutoDates]     = useState<Set<string>>(new Set());
  // ESG 产线列表（动态加载）
  const [esgLines,      setEsgLines]      = useState<string[]>(ESG_LINES_FALLBACK);

  // 加载 ESG 产线配置
  useEffect(() => {
    api.request({
      url: 'esg_line_config:list',
      method: 'get',
      params: { paginate: false, sort: ['sort'] },
    }).then((res: any) => {
      const items = res?.data?.data || [];
      if (items.length > 0) {
        const lines = items
          .filter((i: any) => i.isActive)
          .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0))
          .map((i: any) => i.lineCode);
        if (lines.length > 0) setEsgLines(lines);
      }
    }).catch(() => {/* 降级：保持默认值 */});
  }, [api]);

  // ── 初始化 ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (open && record) {
      form.setFieldsValue({
        chosenLine:  record.chosenLine,
        startDate:   record.startDate  ? dayjs(record.startDate)  : null,
        finishDate:  record.finishDate ? dayjs(record.finishDate) : null,
        adjustReason: record.adjustReason || '',
      });
      const plan = record.dailyPlan || {};
      const init: Record<string, number> = {};
      Object.entries(plan).forEach(([d, q]) => { init[d] = Number(q); });
      setPatchMap(init);
      setAddedDates(new Set());
      setAutoDates(new Set());
      setNewDateInput(null);
      setNewQtyInput(0);
      setShowAddRow(false);
      setAutoReSchedule(false);
    }
  }, [open, record]);

  // ── 按日期计算 hook ───────────────────────────────────────────────────────
  const { calcDailyPlan } = useCalcDailyPlan({
    form, record, api, setPatchMap, setAddedDates, setAutoDates,
  });

  // ── 保存 ─────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    let values: any;
    try { values = await form.validateFields(); } catch { return; }

    const originalPlan = record.dailyPlan || {};
    const changedPatch: Record<string, number> = {};
    Object.entries(patchMap).forEach(([d, q]) => {
      if (Number(q) !== Number((originalPlan as any)[d] ?? -1)) {
        changedPatch[d] = Number(q);
      }
    });

    // ── 日期一致性校验 ───────────────────────────────────────────────────
    // 若 patchMap 有非零产量，表单 startDate/finishDate 应与列表实际最早/最晚日期一致
    const effectiveDates = Object.entries(patchMap)
      .filter(([, q]) => Number(q) > 0)
      .map(([d]) => d)
      .sort();

    if (effectiveDates.length > 0) {
      const planMin   = effectiveDates[0];
      const planMax   = effectiveDates[effectiveDates.length - 1];
      const formStart = values.startDate?.format('YYYY-MM-DD') ?? '';
      const formFinish = values.finishDate?.format('YYYY-MM-DD') ?? '';

      if (formStart !== planMin || formFinish !== planMax) {
        const confirmed = await new Promise<boolean>((resolve) => {
          Modal.confirm({
            title: '⚠️ 开始/完成日期与每日产量列表不一致',
            content: (
              <div style={{ lineHeight: '1.8' }}>
                <div>表单日期：<b>{formStart || '未填'}</b> ~ <b>{formFinish || '未填'}</b></div>
                <div>每日列表实际日期：<b>{planMin}</b> ~ <b>{planMax}</b></div>
                <div style={{ marginTop: 8, color: '#888', fontSize: 12 }}>
                  保存后将以每日产量列表的日期为准，表单中填写的日期会被覆盖。
                </div>
              </div>
            ),
            okText: '仍然保存',
            cancelText: '取消，我来修改',
            onOk:     () => resolve(true),
            onCancel: () => resolve(false),
          });
        });
        if (!confirmed) return;
      }
    }

    const payload: any = {
      id: record.id,
      chosenLine:   values.chosenLine,
      startDate:    values.startDate?.format('YYYY-MM-DD'),
      finishDate:   values.finishDate?.format('YYYY-MM-DD'),
      adjustReason: values.adjustReason,
      ...(Object.keys(changedPatch).length > 0 ? { dailyPlanPatch: changedPatch } : {}),
      autoReSchedule,
    };

    setLoading(true);
    try {
      const res = await api.request({
        url: 'scheduling:adjustResult',
        method: 'post',
        data: payload,
      });
      message.success(autoReSchedule ? '✅ 调整已保存，后台重算中…' : '✅ 调整已保存');
      const warnings: string[] = res?.data?.warnings || [];
      if (warnings.length > 0) {
        setTimeout(() => { warnings.forEach((w) => message.warning(w, 8)); }, 500);
      }
      onClose();
      onSaved();
    } catch (e: any) {
      message.error('保存失败：' + (e?.message || '未知错误'));
    } finally {
      setLoading(false);
    }
  };

  if (!record) return null;

  // allDates = 原始计划日期 ∪ 手动新增日期 ∪ patchMap 中的日期（含自动计算的新日期）
  const allDates = [...new Set([
    ...Object.keys(record.dailyPlan || {}),
    ...Array.from(addedDates),
    ...Object.keys(patchMap),
  ])];

  return (
    <Drawer
      title={
        <Space>
          <span>✎ 调整排产结果</span>
          {record.isManualAdjusted && <Tag color="orange" style={{ fontSize: 11 }}>已调整</Tag>}
        </Space>
      }
      width={480} open={open} onClose={onClose} destroyOnClose
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {/* 左侧：解锁按钮（仅已锁定记录显示）*/}
          <div>
            {record?.isManualAdjusted && (
              <Popconfirm
                title={
                  <div>
                    <div style={{ fontWeight: 600 }}>确定解锁此记录？</div>
                    <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                      解锁后，点击"调整后重算"时此订单将被重新计算。
                    </div>
                  </div>
                }
                onConfirm={async () => {
                  try {
                    await api.request({
                      url: 'scheduling:adjustResult',
                      method: 'post',
                      data: { id: record.id, unlock: true },
                    });
                    message.success('已解锁');
                    onClose();
                    onSaved();
                  } catch (e: any) {
                    message.error('解锁失败：' + (e?.message || ''));
                  }
                }}
                okText="解锁" cancelText="取消"
              >
                <Button danger size="small">解锁此记录</Button>
              </Popconfirm>
            )}
          </div>

          {/* 右侧：重算开关 + 取消 + 保存 */}
          <Space>
            <Tooltip title="开启后，保存调整的同时自动重排其他未锁定订单">
              <Space size={4}>
                <Text type="secondary" style={{ fontSize: 12 }}>保存后重算</Text>
                <Switch size="small" checked={autoReSchedule} onChange={setAutoReSchedule} />
              </Space>
            </Tooltip>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" loading={loading} onClick={handleSave}>保存调整</Button>
          </Space>
        </div>
      }
    >
      {/* 订单概览 */}
      <div style={{ background: '#f5f7fa', borderRadius: 8, padding: '12px 16px', marginBottom: 20, border: '1px solid #e8edf2' }}>
        <Space size="large" wrap>
          <div><Text type="secondary" style={{ fontSize: 11 }}>生产单号</Text><br /><Text strong>{record.prodId}</Text></div>
          <div><Text type="secondary" style={{ fontSize: 11 }}>物料</Text><br /><Text>{record.itemId}</Text></div>
          <div><Text type="secondary" style={{ fontSize: 11 }}>数量</Text><br /><Text strong>{formatNum(record.totalQty)}</Text></div>
          <div>
            <Text type="secondary" style={{ fontSize: 11 }}>交期</Text><br />
            <Text type="warning" strong>{record.dlvDate ? dayjs(record.dlvDate).format('MM-DD') : '-'}</Text>
          </div>
          <div><Text type="secondary" style={{ fontSize: 11 }}>当前产线</Text><br /><Tag color="cyan">{record.chosenLine}</Tag></div>
        </Space>
      </div>

      <Form form={form} layout="vertical" size="small">
        <Divider orientation="left" style={{ fontSize: 13, marginTop: 0 }}>基本信息调整</Divider>

        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="按日期计算时，开始日期会作为开工时间；如果只填写开始日期，系统会自动向后补齐完成日期。"
        />

        <Form.Item name="chosenLine" label="换产线">
          <Select
            options={esgLines.map(l => ({ value: l, label: l }))}
            placeholder="选择产线" style={{ width: 160 }}
          />
        </Form.Item>

        <Space>
          <Form.Item
            name="startDate" label="开始日期"
            rules={[{ validator: (_: any, val: any) => {
              const end = form.getFieldValue('finishDate');
              if (val && end && val.isAfter(end)) return Promise.reject('开始日期不能晚于完成日期');
              return Promise.resolve();
            }}]}
          >
            <DatePicker format="YYYY-MM-DD" style={{ width: 160 }} />
          </Form.Item>
          <Form.Item
            name="finishDate" label="完成日期"
            rules={[{ validator: (_: any, val: any) => {
              const start = form.getFieldValue('startDate');
              if (val && start && val.isBefore(start)) return Promise.reject('完成日期不能早于开始日期');
              return Promise.resolve();
            }}]}
          >
            <DatePicker format="YYYY-MM-DD" style={{ width: 160 }} />
          </Form.Item>
        </Space>

        {/* 每日产量 */}
        <Divider orientation="left" style={{ fontSize: 13 }} orientationMargin={0}>
          <Space size={8}>
            <span>每日产量</span>
            <Button
              type="dashed" size="small" style={{ fontSize: 12 }}
              onClick={() => { setShowAddRow(true); setNewDateInput(null); setNewQtyInput(0); }}
            >
              + 新增日期
            </Button>
            <Button
              type="text" size="small"
              style={{ fontSize: 12, color: '#8c8c8c', padding: '0 4px' }}
              onClick={() => setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')}
              title="切换日期排序方向"
            >
              {sortDir === 'asc' ? '日期 ↑' : '日期 ↓'}
            </Button>
            <Tooltip title={`根据开始/完成日期按满产能力将 ${(record.totalQty || 0).toLocaleString()} 件分配到工作日（覆盖当前列表）`}>
              <Button
                size="small"
                style={{ fontSize: 12, color: '#13c2c2', borderColor: '#13c2c2', background: 'transparent' }}
                onClick={calcDailyPlan}
              >
                🔁 按日期计算
              </Button>
            </Tooltip>
          </Space>
        </Divider>

        {/* 每日产量列表 */}
        <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 6, padding: '8px 12px' }}>
          {allDates
            .sort((a, b) => sortDir === 'asc' ? a.localeCompare(b) : b.localeCompare(a))
            .map(date => {
              const isAdded  = addedDates.has(date);
              const origQty  = isAdded ? 0 : Number((record.dailyPlan || {})[date] || 0);
              const curQty   = patchMap[date] ?? origQty;
              const changed  = !isAdded && curQty !== origQty;

              const handleDelete = () => {
                if (isAdded) {
                  setPatchMap(prev => { const n = { ...prev }; delete n[date]; return n; });
                  setAddedDates(prev => { const n = new Set(prev); n.delete(date); return n; });
                } else {
                  setPatchMap(prev => ({ ...prev, [date]: 0 }));
                }
              };

              return (
                <div
                  key={date}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 0', borderBottom: '1px dashed #f5f5f5',
                    opacity: (!isAdded && curQty === 0 && origQty > 0) ? 0.4 : 1,
                  }}
                >
                  <Space size={6}>
                    <Text style={{ fontSize: 13, width: 50 }}>{dayjs(date).format('MM-DD')}</Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>{dayjs(date).format('ddd')}</Text>
                    {isAdded && <Tag color="orange" style={{ fontSize: 10, padding: '0 4px' }}>新增</Tag>}
                    {autoDates.has(date) && !isAdded && <Tag color="cyan" style={{ fontSize: 10, padding: '0 4px' }}>自动</Tag>}
                    {changed && !autoDates.has(date) && <Tag color="blue" style={{ fontSize: 10, padding: '0 4px' }}>已改</Tag>}
                    {!isAdded && curQty === 0 && origQty > 0 && <Tag color="red" style={{ fontSize: 10, padding: '0 4px' }}>已删</Tag>}
                  </Space>
                  <Space size={4} align="center">
                    <InputNumber
                      size="small" min={0} step={100} value={curQty} style={{ width: 100 }}
                      onChange={val => setPatchMap(prev => ({ ...prev, [date]: val ?? 0 }))}
                      addonAfter="pcs"
                    />
                    <Tooltip title={isAdded ? '移除此行' : '将此日期产量清零（等同删除）'}>
                      <Button type="text" size="small" danger style={{ padding: '0 4px' }} onClick={handleDelete}>×</Button>
                    </Tooltip>
                  </Space>
                </div>
              );
            })
          }

          {/* 新增日期行 */}
          {showAddRow && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: '1px solid #f0f0f0', marginTop: 4 }}>
              <DatePicker
                size="small" format="YYYY-MM-DD" value={newDateInput}
                placeholder="选择日期" style={{ width: 130 }}
                onChange={(val: any) => setNewDateInput(val)}
                disabledDate={(d: any) => {
                  const key = d?.format('YYYY-MM-DD');
                  const existingKeys = new Set([
                    ...Object.keys(record.dailyPlan || {}),
                    ...Array.from(addedDates),
                  ]);
                  return existingKeys.has(key);
                }}
              />
              <InputNumber
                size="small" min={0} step={100} value={newQtyInput}
                style={{ width: 100 }} onChange={val => setNewQtyInput(val ?? 0)}
                addonAfter="pcs" placeholder="产量"
              />
              <Button
                type="primary" size="small"
                disabled={!newDateInput || newQtyInput <= 0}
                onClick={() => {
                  const dateStr = newDateInput.format('YYYY-MM-DD');
                  setPatchMap(prev => ({ ...prev, [dateStr]: newQtyInput }));
                  setAddedDates(prev => new Set([...prev, dateStr]));
                  setNewDateInput(null); setNewQtyInput(0); setShowAddRow(false);
                }}
              >
                确认
              </Button>
              <Button size="small" onClick={() => { setNewDateInput(null); setNewQtyInput(0); setShowAddRow(false); }}>
                取消
              </Button>
            </div>
          )}

          {allDates.length === 0 && !showAddRow && (
            <div style={{ textAlign: 'center', padding: '16px 0', color: '#bfbfbf', fontSize: 12 }}>
              暂无产量数据，点击「+ 新增日期」添加
            </div>
          )}
        </div>

        <Divider orientation="left" style={{ fontSize: 13 }}>调整备注</Divider>
        <Form.Item name="adjustReason">
          <Input.TextArea rows={3} placeholder="请输入调整原因（选填）" maxLength={200} showCount />
        </Form.Item>
        <Alert
          type="warning" showIcon style={{ marginTop: 8 }}
          message={
            <span>
              注意：本次调整将被<Text strong>锁定</Text>。点击"调整后重算"可在保留此锁定的前提下重排其余订单；
              全量重排将覆盖所有调整。
            </span>
          }
        />
      </Form>
    </Drawer>
  );
};
