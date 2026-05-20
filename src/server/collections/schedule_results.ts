import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: 'schedule_results',
  title: '排产结果',
  filterTargetKey: 'id',
  fields: [
    // ── MO 标识 ──
    {
      type: 'string',
      name: 'prodId',
      title: '生产单号',
    },
    {
      type: 'string',
      name: 'itemId',
      title: '成品编码',
    },
    // ── MO 信息 ──
    {
      type: 'integer',
      name: 'totalQty',
      title: '订单数量',
    },
    {
      type: 'date',
      name: 'dlvDate',
      title: '交期',
    },
    {
      type: 'string',
      name: 'prodStatus',
      title: '订单状态',
    },
    {
      type: 'string',
      name: 'prodPoolId',
      title: '订单池',
    },
    {
      type: 'string',
      name: 'osmCategory',
      title: '品类',
    },
    // ── 排产汇总 ──
    {
      type: 'date',
      name: 'startDate',
      title: '开始日',
    },
    {
      type: 'date',
      name: 'finishDate',
      title: '完成日',
    },
    {
      type: 'boolean',
      name: 'isOverdue',
      title: '是否逾期',
      defaultValue: false,
    },
    {
      type: 'integer',
      name: 'overdueDays',
      title: '逾期天数',
      defaultValue: 0,
    },
    {
      type: 'string',
      name: 'overdueType',
      title: '逾期类型',
      // ON_TIME=按时 | AT_RISK=排产逾期 | PAST_DUE=已过交期
      defaultValue: 'ON_TIME',
    },
    {
      type: 'string',
      name: 'candidateLines',
      title: '候选产线',
    },
    {
      type: 'string',
      name: 'chosenLine',
      title: '选中产线',
    },
    // ── 每日排产计划（JSON: {"2026-05-15": 3000, "2026-05-16": 2000}）──
    {
      type: 'json',
      interface: 'json',
      name: 'dailyPlan',
      title: '每日排产',
    },
  ],
});
