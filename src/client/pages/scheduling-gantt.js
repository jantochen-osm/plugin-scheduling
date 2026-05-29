const { React, antd, libs } = ctx;
const { useState, useEffect, useMemo, useCallback } = React;
const {
  Table, Tag, Typography, Space, message, Button, Radio, Popover, Descriptions,
  Drawer, Form, Select, DatePicker, InputNumber, Input, Modal, Alert, Divider, Tooltip,
} = antd;
const { Text, Title } = Typography;
const dayjs = libs.dayjs;

const formatNum = (num, decimals = 0) => {
  if (num === undefined || num === null || isNaN(num)) return 0;
  const n = Number(num);
  if (Math.abs(n) < 0.0001) return 0; 
  return Number(n.toFixed(decimals));
};

// ── API Helper ───────────────────────────────────────────────────────────────
const getApi = () => ctx.api || ctx.apiClient || (ctx.app && ctx.app.apiClient);

// ============================================================================
// 子组件：量能明细悬浮卡片 (UI 精细化升级版)
// ============================================================================
const CapacityDetailCard = ({ date, detail, isGlobalRest }) => {
  if (!detail) {
    return (
      <div style={{ padding: '8px 4px' }}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          {isGlobalRest ? '休息日 / 无排产计划' : '当日无排产明细'}
        </Text>
      </div>
    );
  }

  const getDayTypeTag = (type) => { 
    switch(type) {
      case 'WORKDAY': return <Tag color="green" style={{ margin: 0, border: 'none' }}>工作日</Tag>;
      case 'OVERTIME': return <Tag color="orange" style={{ margin: 0, border: 'none' }}>加班日</Tag>;
      case 'WEEKEND': return <Tag color="default" style={{ margin: 0, border: 'none' }}>周末/假</Tag>;
      case 'HOLIDAY': return <Tag color="magenta" style={{ margin: 0, border: 'none' }}>法定节假日</Tag>;
      case 'MAINTENANCE': return <Tag color="purple" style={{ margin: 0, border: 'none' }}>设备保养</Tag>;
      default: return <Tag color="blue" style={{ margin: 0, border: 'none' }}>{type || '未知'}</Tag>;
    }
  };

  const hasProductionTask = formatNum(detail.totalQty) > 0 || formatNum(detail.effectiveHours, 2) > 0;

  return (
    <div style={{ width: 270 }}>
      {/* 头部：日期与类型标签 */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        paddingBottom: 12, 
        marginBottom: 16,
        borderBottom: '1px solid #f0f0f0' 
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <Text strong style={{ fontSize: 16 }}>{date}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{detail.dayLabel || dayjs(date).format('dddd')}</Text>
        </div>
        {getDayTypeTag(detail.dayType)}
      </div>

      {!hasProductionTask ? (
        <Text type="secondary" style={{ fontSize: 13 }}>当日无排班或生产任务</Text>
      ) : (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          
          {/* 模块 A：产量构成 */}
          <div style={{ backgroundColor: '#fafafa', padding: '14px 16px', borderRadius: 8, border: '1px solid #f0f0f0' }}>
            <div style={{ marginBottom: 6 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>总排产 (PCS)</Text>
            </div>
            <div style={{ fontSize: 26, fontWeight: '900', color: '#1677ff', lineHeight: 1 }}>
              {formatNum(detail.totalQty)}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 12, borderTop: '1px dashed #e8e8e8', paddingTop: 10 }}>
              <Text type="secondary">标准: <Text strong style={{ color: 'rgba(0, 0, 0, 0.88)', fontSize: 13 }}>{formatNum(detail.standardQty)}</Text></Text>
              <Text type="secondary">加班: <Text strong type={formatNum(detail.overtimeQty) > 0 ? "warning" : "secondary"} style={{ fontSize: 13 }}>{formatNum(detail.overtimeQty)}</Text></Text>
            </div>
          </div>

          {/* 模块 B：工时与人力参数 */}
          <Descriptions size="small" column={2} layout="vertical" colon={false} style={{ margin: 0 }}>
            <Descriptions.Item label={<Text type="secondary" style={{ fontSize: 12 }}>计划总耗时</Text>} style={{ paddingBottom: 8 }}>
              <Text strong>{formatNum((Number(detail.effectiveHours) || 0) + (Number(detail.overtimeHours) || 0) + (Number(detail.setupHours) || 0), 2)}h</Text>
              {formatNum(detail.setupHours, 2) > 0 && <span style={{ fontSize: 12, color: '#ff4d4f', marginLeft: 4 }}>(-{formatNum(detail.setupHours, 2)}h)</span>}
            </Descriptions.Item>
            <Descriptions.Item label={<Text type="secondary" style={{ fontSize: 12 }}>实际人力</Text>} style={{ paddingBottom: 8 }}>
              <Text strong>{formatNum(detail.actualHeadcount)}人</Text>
              {formatNum(detail.actualHeadcount) > formatNum(detail.headcount) && <Tag color="warning" bordered={false} style={{ marginLeft: 4, padding: '0 4px', fontSize: 10 }}>借调</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label={<Text type="secondary" style={{ fontSize: 12 }}>有效 UPH</Text>} style={{ paddingBottom: 0 }}>
              <Text strong>{formatNum(detail.effectiveUph, 2) || '-'}</Text>
            </Descriptions.Item>
            <Descriptions.Item label={<Text type="secondary" style={{ fontSize: 12 }}>单人 UPH</Text>} style={{ paddingBottom: 0 }}>
              <Text strong>{formatNum(detail.perPersonUph, 2) || '-'}</Text>
            </Descriptions.Item>
          </Descriptions>
        </Space>
      )}
    </div>
  );
};

// ============================================================================
// 子组件：调整 Drawer
// ============================================================================
const ESG_LINES = ['4F1', '4F2', '4F4', '4F6'];

const AdjustDrawer = ({ open, record, onClose, onSaved }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  // 每日产量补丁：{ date: inputQty }（含原有日期的修改 + 用户新增的日期）
  const [patchMap, setPatchMap] = useState({});
  // 记录用户手动新增的日期（原 dailyPlan 中没有的），用于区分标签和删除行为
  const [addedDates, setAddedDates] = useState(new Set());
  // 内联「新增日期」行的临时输入状态
  const [newDateInput, setNewDateInput] = useState(null);
  const [newQtyInput, setNewQtyInput]   = useState(0);
  const [showAddRow, setShowAddRow]     = useState(false); // 控制内联新增行显示
  const [sortDir, setSortDir]           = useState('asc'); // 日期列表排序方向

  // 打开时初始化表单
  useEffect(() => {
    if (open && record) {
      form.setFieldsValue({
        chosenLine: record.chosenLine,
        startDate:  record.startDate  ? dayjs(record.startDate)  : null,
        finishDate: record.finishDate ? dayjs(record.finishDate) : null,
        adjustReason: record.adjustReason || '',
      });
      // 初始化每日产量（以原始值填充）
      const plan = record.dailyPlan || {};
      const init = {};
      Object.entries(plan).forEach(([d, q]) => { init[d] = Number(q); });
      setPatchMap(init);
      // 重置新增状态
      setAddedDates(new Set());
      setNewDateInput(null);
      setNewQtyInput(0);
      setShowAddRow(false);
    }
  }, [open, record]);

  const handleSave = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const originalPlan = record.dailyPlan || {};
    // 只提交被修改的日期
    const changedPatch = {};
    Object.entries(patchMap).forEach(([d, q]) => {
      if (Number(q) !== Number(originalPlan[d] ?? -1)) {
        changedPatch[d] = Number(q);
      }
    });

    const payload = {
      id: record.id,
      chosenLine:   values.chosenLine,
      startDate:    values.startDate?.format('YYYY-MM-DD'),
      finishDate:   values.finishDate?.format('YYYY-MM-DD'),
      adjustReason: values.adjustReason,
      ...(Object.keys(changedPatch).length > 0 ? { dailyPlanPatch: changedPatch } : {}),
    };

    setLoading(true);
    try {
      const api = getApi();
      await api.request({
        url:    'scheduling:adjustResult',
        method: 'post',
        data:   payload,
      });
      message.success('✅ 调整已保存');
      onClose();
      onSaved();
    } catch (e) {
      message.error('保存失败：' + (e?.message || '未知错误'));
    } finally {
      setLoading(false);
    }
  };

  if (!record) return null;

  const planDates = Object.keys(record.dailyPlan || {}).sort();

  return (
    <Drawer
      title={
        <Space>
          <span>✎ 调整排产结果</span>
          {record.isManualAdjusted && <Tag color="orange" style={{ fontSize: 11 }}>已调整</Tag>}
        </Space>
      }
      width={480}
      open={open}
      onClose={onClose}
      destroyOnClose
      footer={
        <div style={{ textAlign: 'right' }}>
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" loading={loading} onClick={handleSave}>
              保存调整
            </Button>
          </Space>
        </div>
      }
    >
      {/* 订单信息摘要 */}
      <div style={{
        background: '#f5f7fa', borderRadius: 8, padding: '12px 16px',
        marginBottom: 20, border: '1px solid #e8edf2',
      }}>
        <Space size="large" wrap>
          <div><Text type="secondary" style={{ fontSize: 11 }}>生产单号</Text><br /><Text strong>{record.prodId}</Text></div>
          <div><Text type="secondary" style={{ fontSize: 11 }}>物料</Text><br /><Text>{record.itemId}</Text></div>
          <div><Text type="secondary" style={{ fontSize: 11 }}>数量</Text><br /><Text strong>{formatNum(record.totalQty)}</Text></div>
          <div><Text type="secondary" style={{ fontSize: 11 }}>交期</Text><br /><Text type="warning" strong>{record.dlvDate ? dayjs(record.dlvDate).format('MM-DD') : '-'}</Text></div>
          <div><Text type="secondary" style={{ fontSize: 11 }}>当前产线</Text><br /><Tag color="cyan">{record.chosenLine}</Tag></div>
        </Space>
      </div>

      <Form form={form} layout="vertical" size="small">
        {/* 基本信息调整 */}
        <Divider orientation="left" style={{ fontSize: 13, marginTop: 0 }}>基本信息调整</Divider>

        <Form.Item name="chosenLine" label="换产线">
          <Select
            options={ESG_LINES.map(l => ({ value: l, label: l }))}
            placeholder="选择产线"
            style={{ width: 160 }}
          />
        </Form.Item>

        <Space>
          <Form.Item
            name="startDate"
            label="开始日期"
            rules={[{
              validator: (_, val) => {
                const end = form.getFieldValue('finishDate');
                if (val && end && val.isAfter(end)) return Promise.reject('开始日期不能晚于完成日期');
                return Promise.resolve();
              }
            }]}
          >
            <DatePicker format="YYYY-MM-DD" style={{ width: 160 }} />
          </Form.Item>
          <Form.Item
            name="finishDate"
            label="完成日期"
            rules={[{
              validator: (_, val) => {
                const start = form.getFieldValue('startDate');
                if (val && start && val.isBefore(start)) return Promise.reject('完成日期不能早于开始日期');
                return Promise.resolve();
              }
            }]}
          >
            <DatePicker format="YYYY-MM-DD" style={{ width: 160 }} />
          </Form.Item>
        </Space>

        {/* 每日产量（原有 + 新增） */}
        <>
          <Divider
            orientation="left"
            style={{ fontSize: 13 }}
            orientationMargin={0}
          >
            <Space size={8}>
              <span>每日产量</span>
              <Button
                type="dashed"
                size="small"
                style={{ fontSize: 12 }}
                onClick={() => { setShowAddRow(true); setNewDateInput(null); setNewQtyInput(0); }}
              >
                + 新增日期
              </Button>
              <Button
                type="text"
                size="small"
                style={{ fontSize: 12, color: '#8c8c8c', padding: '0 4px' }}
                onClick={() => setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')}
                title="切换日期排序方向"
              >
                {sortDir === 'asc' ? '日期 ↑' : '日期 ↓'}
              </Button>
            </Space>
          </Divider>

          <div style={{
            maxHeight: 320, overflowY: 'auto',
            border: '1px solid #f0f0f0', borderRadius: 6, padding: '8px 12px',
          }}>
            {/* 合并原有日期 + 用户新增日期，按 sortDir 排序 */}
            {[...new Set([
              ...Object.keys(record.dailyPlan || {}),
              ...Object.keys(patchMap).filter(d => addedDates.has(d)),
            ])].sort((a, b) => sortDir === 'asc' ? a.localeCompare(b) : b.localeCompare(a)).map(date => {
              const isAdded  = addedDates.has(date);
              const origQty  = isAdded ? 0 : Number((record.dailyPlan || {})[date] || 0);
              const curQty   = patchMap[date] ?? origQty;
              const changed  = !isAdded && curQty !== origQty;

              const handleDelete = () => {
                if (isAdded) {
                  // 新增行：直接从 patchMap 和 addedDates 移除
                  setPatchMap(prev => { const n = { ...prev }; delete n[date]; return n; });
                  setAddedDates(prev => { const n = new Set(prev); n.delete(date); return n; });
                } else {
                  // 原有行：置 0（提交时后端会从 dailyPlan 中删除该日期）
                  setPatchMap(prev => ({ ...prev, [date]: 0 }));
                }
              };

              return (
                <div key={date} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 0', borderBottom: '1px dashed #f5f5f5',
                  opacity: (!isAdded && curQty === 0 && origQty > 0) ? 0.4 : 1,
                }}>
                  <Space size={6}>
                    <Text style={{ fontSize: 13, width: 50 }}>{dayjs(date).format('MM-DD')}</Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>{dayjs(date).format('ddd')}</Text>
                    {isAdded  && <Tag color="orange" style={{ fontSize: 10, padding: '0 4px' }}>新增</Tag>}
                    {changed  && <Tag color="blue"   style={{ fontSize: 10, padding: '0 4px' }}>已改</Tag>}
                    {!isAdded && curQty === 0 && origQty > 0 &&
                      <Tag color="red" style={{ fontSize: 10, padding: '0 4px' }}>已删</Tag>}
                  </Space>
                  <Space size={4} align="center">
                    <InputNumber
                      size="small"
                      min={0}
                      step={100}
                      value={curQty}
                      style={{ width: 100 }}
                      onChange={val => setPatchMap(prev => ({ ...prev, [date]: val ?? 0 }))}
                      addonAfter="pcs"
                    />
                    <Tooltip title={isAdded ? '移除此行' : '将此日期产量清零（等同删除）'}>
                      <Button
                        type="text"
                        size="small"
                        danger
                        style={{ padding: '0 4px' }}
                        onClick={handleDelete}
                      >
                        ×
                      </Button>
                    </Tooltip>
                  </Space>
                </div>
              );
            })}

            {/* 内联新增行 */}
            {showAddRow && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 0', borderTop: '1px solid #f0f0f0', marginTop: 4,
              }}>
                <DatePicker
                  size="small"
                  format="YYYY-MM-DD"
                  value={newDateInput}
                  placeholder="选择日期"
                  style={{ width: 130 }}
                  onChange={val => setNewDateInput(val)}
                  disabledDate={d => {
                    // 禁用已在列表中的日期
                    const key = d?.format('YYYY-MM-DD');
                    const existingKeys = new Set([
                      ...Object.keys(record.dailyPlan || {}),
                      ...Array.from(addedDates),
                    ]);
                    return existingKeys.has(key);
                  }}
                />
                <InputNumber
                  size="small"
                  min={0}
                  step={100}
                  value={newQtyInput}
                  style={{ width: 100 }}
                  onChange={val => setNewQtyInput(val ?? 0)}
                  addonAfter="pcs"
                  placeholder="产量"
                />
                <Button
                  type="primary"
                  size="small"
                  disabled={!newDateInput || newQtyInput <= 0}
                  onClick={() => {
                    const dateStr = newDateInput.format('YYYY-MM-DD');
                    setPatchMap(prev => ({ ...prev, [dateStr]: newQtyInput }));
                    setAddedDates(prev => new Set([...prev, dateStr]));
                    setNewDateInput(null);
                    setNewQtyInput(0);
                    setShowAddRow(false);
                  }}
                >
                  确认
                </Button>
                <Button
                  size="small"
                  onClick={() => { setNewDateInput(null); setNewQtyInput(0); setShowAddRow(false); }}
                >
                  取消
                </Button>
              </div>
            )}

            {/* 空状态提示 */}
            {[...new Set([
              ...Object.keys(record.dailyPlan || {}),
              ...Array.from(addedDates),
            ])].length === 0 && !showAddRow && (
              <div style={{ textAlign: 'center', padding: '16px 0', color: '#bfbfbf', fontSize: 12 }}>
                暂无产量数据，点击「+ 新增日期」添加
              </div>
            )}
          </div>
        </>

        {/* 调整备注 */}
        <Divider orientation="left" style={{ fontSize: 13 }}>调整备注</Divider>
        <Form.Item name="adjustReason">
          <Input.TextArea rows={3} placeholder="请输入调整原因（选填）" maxLength={200} showCount />
        </Form.Item>

        {/* 覆盖提示 */}
        <Alert
          type="warning"
          showIcon
          message="注意：重新执行排产后，本次调整将被覆盖，无法恢复。"
          style={{ marginTop: 8 }}
        />
      </Form>
    </Drawer>
  );
};

// ============================================================================
// 主页面组件
// ============================================================================
const ProductionScheduleMatrix = () => {
  const [rawRecords, setRawRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState('grouped'); 
  const [factoryCalendar, setFactoryCalendar] = useState({});

  // 调整 Drawer 状态
  const [drawerOpen, setDrawerOpen]   = useState(false);
  const [drawerRecord, setDrawerRecord] = useState(null);

  const openDrawer = useCallback((record) => {
    setDrawerRecord(record);
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setDrawerRecord(null);
  }, []);

  const fetchScheduleData = async () => {
    setLoading(true);
    try {
      const api = getApi();
      
      const response = await api.request({
        url: 'schedule_results_v2:list',
        method: 'get',
        params: { paginate: false, pageSize: 1000, sort: 'startDate' }
      });

      const records = response?.data?.data || response?.data || [];
      
      let minGlobalDate = null;
      let maxGlobalDate = null;

      const processedRecords = records.map(record => {
        const dailyPlan = typeof record.dailyPlan === 'string' ? JSON.parse(record.dailyPlan || '{}') : (record.dailyPlan || {});
        const dailyPlanDetail = typeof record.dailyPlanDetail === 'string' ? JSON.parse(record.dailyPlanDetail || '{}') : (record.dailyPlanDetail || {});
        
        let maxBaseHours = 10; 
        const hoursArray = Object.values(dailyPlanDetail).map(d => Number(d.baseWorkHours) || 0);
        if (hoursArray.length > 0 && Math.max(...hoursArray) > 0) {
           maxBaseHours = Math.max(...hoursArray);
        }
        
        let fallbackStandardCapacity = (Number(record.uph) || 0) * maxBaseHours;
        if (fallbackStandardCapacity <= 0) {
           fallbackStandardCapacity = Math.max(1, ...Object.values(dailyPlan).map(v => Number(v) || 0));
        }

        if (record.startDate) {
          const s = dayjs(record.startDate);
          if (!minGlobalDate || s.isBefore(minGlobalDate)) minGlobalDate = s;
        }
        if (record.finishDate) {
          const f = dayjs(record.finishDate);
          if (!maxGlobalDate || f.isAfter(maxGlobalDate)) maxGlobalDate = f;
        }
        
        return {
          ...record,
          id: record.id || `record_${Math.random().toString(36).substring(2, 9)}`,
          dailyPlan,
          dailyPlanDetail,
          fallbackStandardCapacity 
        };
      });

      setRawRecords(processedRecords);

      // 请求这段时间内的工厂日历数据，作为休息日背景底色的绝对基准
      if (minGlobalDate && maxGlobalDate) {
        const calResponse = await api.request({
          url: 'md_work_calendars:list',
          method: 'get',
          params: {
            paginate: false,
            pageSize: 500, 
            filter: JSON.stringify({ 
              calendarDate: { 
                $gte: minGlobalDate.format('YYYY-MM-DD'), 
                $lte: maxGlobalDate.format('YYYY-MM-DD') 
              } 
            })
          }
        });
        
        const calRecords = calResponse?.data?.data || calResponse?.data || [];
        const calMap = {};
        calRecords.forEach(cal => {
          if (cal.calendarDate) calMap[cal.calendarDate] = cal;
        });
        setFactoryCalendar(calMap);
      }

      if (processedRecords.length > 0) message.success('排产数据及日历矩阵已更新');
    } catch (error) {
      console.error('NocoBase Error:', error);
      message.error('数据拉取失败，请检查网络。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchScheduleData(); }, []);

  const tableData = useMemo(() => {
    if (viewMode === 'flat') return rawRecords;

    const lineMap = {};
    rawRecords.forEach(record => {
      const line = record.chosenLine || '未分配产线';
      
      if (!lineMap[line]) {
        lineMap[line] = {
          id: `group_${line}`, 
          prodId: `【产线汇总】 ${line}`,
          chosenLine: line,
          isGroupHeader: true, 
          totalQty: 0,
          dailyPlan: {},
          dailyTotalTime: {}, 
          dailyBaseTime: {},  
          children: [],
          startDate: record.startDate, 
          finishDate: record.finishDate,
        };
      }

      const group = lineMap[line];
      group.children.push(record);
      group.totalQty += Number(record.totalQty || 0);

      if (dayjs(record.startDate).isBefore(dayjs(group.startDate))) group.startDate = record.startDate;
      if (dayjs(record.finishDate).isAfter(dayjs(group.finishDate))) group.finishDate = record.finishDate;

      Object.entries(record.dailyPlan).forEach(([date, qty]) => {
        group.dailyPlan[date] = (group.dailyPlan[date] || 0) + Number(qty);
        
        const detail = record.dailyPlanDetail?.[date];
        if (detail) {
            const tTime = (Number(detail.effectiveHours) || 0) + (Number(detail.overtimeHours) || 0) + (Number(detail.setupHours) || 0);
            group.dailyTotalTime[date] = (group.dailyTotalTime[date] || 0) + tTime;
            group.dailyBaseTime[date] = Math.max(group.dailyBaseTime[date] || 0, Number(detail.baseWorkHours) || 10);
        }
      });
    });

    Object.values(lineMap).forEach(group => {
      group.maxQty = Math.max(1, ...Object.values(group.dailyPlan).map(v => Number(v) || 0));
    });

    return Object.values(lineMap).sort((a, b) => a.chosenLine.localeCompare(b.chosenLine));
  }, [rawRecords, viewMode]);

  const dynamicDateColumns = useMemo(() => {
    if (!rawRecords || rawRecords.length === 0) return [];
    
    let minGlobalDate = null;
    let maxGlobalDate = null;

    rawRecords.forEach(r => {
      if (!r.startDate || !r.finishDate) return;
      const s = dayjs(r.startDate);
      const f = dayjs(r.finishDate);
      if (!minGlobalDate || s.isBefore(minGlobalDate)) minGlobalDate = s;
      if (!maxGlobalDate || f.isAfter(maxGlobalDate)) maxGlobalDate = f;
    });

    if (!minGlobalDate || !maxGlobalDate) return [];

    const globalDates = [];
    let current = minGlobalDate.clone();
    while (current.isBefore(maxGlobalDate) || current.isSame(maxGlobalDate, 'day')) {
      globalDates.push(current.format('YYYY-MM-DD'));
      current = current.add(1, 'day');
    }

    const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return globalDates.map(date => {
      const cellDate = dayjs(date);
      const dayOfWeek = WEEKDAYS_EN[cellDate.day()];
      const isRestDayHeader = factoryCalendar[date] ? !factoryCalendar[date].isWorkday : (cellDate.day() === 0 || cellDate.day() === 6);

      return {
        title: (
          <div style={{ textAlign: 'center', lineHeight: '1.2' }}>
            <div style={{ fontSize: '10px', color: '#8c8c8c' }}>
              {cellDate.format('MM/DD')}
            </div>
            <div style={{ 
              fontSize: '11px', 
              fontWeight: 'bold',
              color: isRestDayHeader ? '#ff4d4f' : 'inherit' 
            }}>
               {dayOfWeek}
            </div>
          </div>
        ),
        dataIndex: ['dailyPlan', date],
        key: date,
        align: 'center',
        width: 48, 
        onCell: () => ({ style: { padding: 0 } }), 
        render: (val, record) => {
          const startDate = dayjs(record.startDate).format('YYYY-MM-DD');
          const finishDate = dayjs(record.finishDate).format('YYYY-MM-DD');
          const inRange = date >= startDate && date <= finishDate;
          const hasData = val !== undefined && val !== null; 
          const qty = Number(val) || 0;
          
          let isRestDayBackground = false;
          if (factoryCalendar[date]) {
              isRestDayBackground = !factoryCalendar[date].isWorkday;
          } else {
              isRestDayBackground = cellDate.day() === 0 || cellDate.day() === 6;
          }

          const baseStyle = {
            width: '100%', height: '100%', minHeight: '38px', 
            display: 'flex', justifyContent: 'center', position: 'relative',
            boxSizing: 'border-box', paddingBottom: '2px', 
          };

          if (!inRange) {
            return (
              <div style={{ 
                ...baseStyle, backgroundColor: '#f5f5f5', 
                backgroundImage: 'repeating-linear-gradient(-45deg, transparent, transparent 4px, rgba(0,0,0,0.04) 4px, rgba(0,0,0,0.04) 8px)',
                alignItems: 'center', 
              }} title="非生产周期">
                <span style={{ color: 'rgba(0,0,0,0.15)', fontSize: '12px' }}>-</span>
              </div>
            );
          }

          const restStyle = isRestDayBackground ? { 
              backgroundColor: '#f0f0f0', borderLeft: '1px solid #e8e8e8', borderRight: '1px solid #e8e8e8'
          } : { backgroundColor: '#ffffff' };

          let CellContent = null;

          if (!hasData) {
            CellContent = <div style={{ ...baseStyle, ...restStyle, borderBottom: '2px solid #e8e8e8' }} />;
          } else if (qty === 0) {
            CellContent = (
               <div style={{ ...baseStyle, ...restStyle, borderBottom: '2px solid #e8e8e8', alignItems: 'flex-end' }}>
                 <span style={{ color: 'rgba(0,0,0,0.25)', fontSize: '11px', fontWeight: 'bold' }}>0</span>
               </div>
            );
          } else {
            let capacityRatio = 0;
            
            if (record.isGroupHeader) {
                const tTime = record.dailyTotalTime?.[date] || 0;
                const bTime = record.dailyBaseTime?.[date] || 10;
                if (tTime > 0) {
                    capacityRatio = tTime / bTime;
                } else {
                    capacityRatio = qty / (record.maxQty || 1);
                }
            } else {
                const detail = record.dailyPlanDetail?.[date];
                if (detail) {
                    const tTime = (Number(detail.effectiveHours) || 0) + (Number(detail.overtimeHours) || 0) + (Number(detail.setupHours) || 0);
                    const bTime = Number(detail.baseWorkHours) || 10;
                    if (tTime > 0) capacityRatio = tTime / bTime;
                    else capacityRatio = qty / (record.fallbackStandardCapacity || 1);
                } else {
                    capacityRatio = qty / (record.fallbackStandardCapacity || 1);
                }
            }

            const isOverload = capacityRatio > 1.05; 
            const heightPercent = Math.min(Math.max(capacityRatio * 100, 10), 100); 
            
            let barColor = record.isGroupHeader ? '#52c41a' : '#1677ff'; 
            if (isOverload) barColor = '#fa8c16'; 
            
            CellContent = (
              <div style={{ ...baseStyle, ...restStyle, alignItems: 'flex-end' }}>
                <div style={{
                  position: 'absolute',
                  bottom: 0, left: 0, width: '100%',
                  height: `${heightPercent}%`,
                  backgroundColor: barColor,
                  opacity: isOverload ? 0.4 : 0.25, 
                  transition: 'all 0.3s ease'
                }} />
                <div style={{ 
                  position: 'relative', 
                  zIndex: 1, 
                  fontSize: '11px', 
                  fontWeight: 'bold', 
                  color: barColor,
                  borderBottom: record.isGroupHeader ? 'none' : '1px dashed #91caff',
                  cursor: record.isGroupHeader ? 'default' : 'pointer'
                }}>
                  {formatNum(qty)}
                </div>
              </div>
            );
          }

          if (record.isGroupHeader) return CellContent;

          const dayDetail = record.dailyPlanDetail ? record.dailyPlanDetail[date] : null;

          return (
            <Popover 
              content={<CapacityDetailCard date={date} detail={dayDetail} isGlobalRest={isRestDayBackground} />}
              title={null} trigger="hover" placement="left" mouseEnterDelay={0.3} 
              overlayInnerStyle={{ 
                padding: '16px 20px', 
                borderRadius: '12px',
                boxShadow: '0 6px 16px -8px rgba(0,0,0,0.08), 0 9px 28px 0 rgba(0,0,0,0.05), 0 12px 48px 16px rgba(0,0,0,0.03)'
              }}
            >
              {CellContent}
            </Popover>
          );
        }
      };
    });
  }, [rawRecords, factoryCalendar]);

  const baseColumns = [
    { 
      title: '生产单号 / 产线汇总', dataIndex: 'prodId', key: 'prodId', fixed: 'left', width: 200,
      render: (text, record) => {
        if (record.isGroupHeader) return <Text strong style={{ fontSize: '13px' }}>{text}</Text>;
        return (
          <Space size={4} align="center">
            <Space direction="vertical" size={0}>
              <Text strong>{text}</Text>
              {record.isOverdue && <Tag color="red" style={{ margin: 0, fontSize: '10px' }}>逾期</Tag>}
            </Space>
            {/* ✎ 已调整标签 */}
            {record.isManualAdjusted && (
              <Tooltip title={record.adjustReason ? `调整备注：${record.adjustReason}` : '已人工调整'}>
                <Tag color="orange" style={{ fontSize: 10, padding: '0 4px', cursor: 'default' }}>✎ 已调整</Tag>
              </Tooltip>
            )}
            {/* 调整按钮 */}
            <Tooltip title="调整此排产结果">
              <Button
                type="link"
                size="small"
                style={{ padding: '0 2px', color: '#1677ff', fontSize: 14 }}
                onClick={(e) => { e.stopPropagation(); openDrawer(record); }}
              >
                ✎
              </Button>
            </Tooltip>
          </Space>
        );
      }
    },
    { 
      title: '交期', dataIndex: 'dlvDate', key: 'dlvDate', fixed: 'left', width: 90,
      render: (val, record) => record.isGroupHeader ? '-' : (val ? <Text strong type="warning">{dayjs(val).format('MM-DD')}</Text> : '-')
    },
    { 
      title: '物料', dataIndex: 'itemId', key: 'itemId', fixed: 'left', width: 120,
      render: (val, record) => record.isGroupHeader ? '-' : <Text style={{ fontSize: '12px' }}>{val}</Text> 
    },
    { 
      title: '产线', dataIndex: 'chosenLine', key: 'chosenLine', fixed: 'left', width: 70,
      render: (text, record) => record.isGroupHeader ? null : <Tag color="cyan">{text}</Tag>
    },
    { 
      title: 'UPH', dataIndex: 'uph', key: 'uph', fixed: 'left', width: 70,
      render: (val, record) => (record.isGroupHeader || !val) ? '-' : <Text type="secondary">{formatNum(val, 1)}</Text>
    },
    { 
      title: '人力', dataIndex: 'headcount', key: 'headcount', fixed: 'left', width: 60,
      render: (val, record) => (record.isGroupHeader || !val) ? '-' : <Text type="secondary">{val}</Text>
    },
    { 
      title: '总排量', dataIndex: 'totalQty', key: 'totalQty', fixed: 'left', align: 'right', width: 80,
      render: (val, record) => (
        <Text strong style={{ color: record.isGroupHeader ? '#52c41a' : 'inherit' }}>
          {formatNum(val)}
        </Text>
      )
    }
  ];

  const columns = [...baseColumns, ...dynamicDateColumns];

  return (
    <div style={{ padding: '24px', backgroundColor: '#fff', borderRadius: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <Space size="large">
          <Title level={4} style={{ margin: 0 }}>车间排产动态矩阵 (Gantt)</Title>
          <Radio.Group value={viewMode} onChange={(e) => setViewMode(e.target.value)} buttonStyle="solid">
            <Radio.Button value="flat">按订单明细</Radio.Button>
            <Radio.Button value="grouped">按产线树形排期</Radio.Button>
          </Radio.Group>
        </Space>
        
        <Space>
          <Text type="secondary" style={{ fontSize: '12px' }}>
            共计 {rawRecords.length} 条单据 | 日期跨度: {dynamicDateColumns.length} 天
            {rawRecords.filter(r => r.isManualAdjusted).length > 0 && (
              <> | <Tag color="orange" style={{ fontSize: 10 }}>✎ 已调整 {rawRecords.filter(r => r.isManualAdjusted).length} 条</Tag></>
            )}
          </Text>
          <Button type="primary" onClick={fetchScheduleData} loading={loading}>刷新数据</Button>
        </Space>
      </div>

      <Table
        loading={loading} columns={columns} dataSource={tableData}
        rowKey="id" size="small" bordered
        scroll={{ x: 'max-content', y: 650 }}
        pagination={viewMode === 'flat' ? { pageSize: 50 } : false}
        defaultExpandAllRows={true}
        rowClassName={(record) => record.isManualAdjusted ? 'row-adjusted' : ''}
      />

      {/* 调整 Drawer */}
      <AdjustDrawer
        open={drawerOpen}
        record={drawerRecord}
        onClose={closeDrawer}
        onSaved={fetchScheduleData}
      />
    </div>
  );
};

ctx.render(<ProductionScheduleMatrix />);