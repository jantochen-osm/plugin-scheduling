import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: 'schedule_runs',
  title: '排产运行记录',
  filterTargetKey: 'id',
  fields: [
    {
      type: 'string',
      name: 'runId',
      title: '运行ID',
      unique: true,
    },
    {
      type: 'date',
      name: 'runTime',
      title: '运行时间',
    },
    {
      type: 'string',
      name: 'status',
      title: '运行状态',
      // SUCCESS | PARTIAL | FAILED
      defaultValue: 'COMPLETED',
    },
    {
      type: 'integer',
      name: 'totalOrders',
      title: '总订单数',
    },
    {
      type: 'integer',
      name: 'validOrders',
      title: '有效订单数',
    },
    {
      type: 'integer',
      name: 'scheduledCount',
      title: '排产成功数',
    },
    {
      type: 'integer',
      name: 'exceptionCount',
      title: '异常数',
    },
    {
      type: 'float',
      name: 'successRate',
      title: '成功率',
    },
    {
      type: 'json',
      interface: 'json',
      name: 'lineUtilization',
      title: '产线利用率',
      // 结构: [{ line, totalCapacityHours, usedHours, utilizationRate, orderCount }]
    },
    {
      type: 'json',
      interface: 'json',
      name: 'exceptionBreakdown',
      title: '异常分布',
      // 结构: { PAST_DLV_DATE: 5, MISSING_ROUTE: 2, ... }
    },
  ],
});
