import { defineCollection } from '@nocobase/database';

/**
 * schedule_results_v2 Collection 定义
 *
 * 与 schedule_results 的区别：
 *   - 这张表由 runScheduling / reScheduleAfterAdjust 通过 raw SQL 写入
 *   - 需要在此注册字段，NocoBase list API 才能正确返回所有字段（包括 json 类型）
 */
export default defineCollection({
  name: 'schedule_results_v2',
  title: '排产结果 v2',
  filterTargetKey: 'id',
  // 表已由 raw SQL 创建，不让 NocoBase 迁移时修改表结构
  syncOptions: { alter: false, force: false },
  fields: [
    { type: 'string',  name: 'runId',          title: '排产运行ID' },
    { type: 'string',  name: 'prodId',         title: '生产单号' },
    { type: 'string',  name: 'itemId',         title: '成品编码' },
    { type: 'integer', name: 'totalQty',       title: '订单数量' },
    { type: 'date',    name: 'dlvDate',        title: '交期' },
    { type: 'string',  name: 'prodStatus',     title: '订单状态' },
    { type: 'string',  name: 'prodPoolId',     title: '订单池' },
    { type: 'string',  name: 'osmCategory',    title: '品类' },
    { type: 'date',    name: 'startDate',      title: '开始日' },
    { type: 'date',    name: 'finishDate',      title: '完成日' },
    { type: 'boolean', name: 'isOverdue',      title: '是否逾期',    defaultValue: false },
    { type: 'integer', name: 'overdueDays',    title: '逾期天数',    defaultValue: 0 },
    { type: 'string',  name: 'overdueType',    title: '逾期类型',    defaultValue: 'ON_TIME' },
    { type: 'string',  name: 'candidateLines', title: '候选产线' },
    { type: 'string',  name: 'chosenLine',     title: '选中产线' },
    { type: 'float',   name: 'uph',            title: 'UPH' },
    { type: 'integer', name: 'headcount',      title: '开工人数' },
    { type: 'integer', name: 'qtySched',       title: '计划总量',  defaultValue: 0 },
    { type: 'integer', name: 'qtyActual',      title: '已完成量',  defaultValue: 0 },
    { type: 'integer', name: 'completionRate', title: '完成率%',   defaultValue: 0 },
    // ── JSON 字段（必须显式注册，否则 list API 不返回）──────────────────
    { type: 'json',    name: 'dailyPlan',       title: '每日排产',    interface: 'json' },
    { type: 'json',    name: 'dailyPlanDetail', title: '每日排产明细', interface: 'json' },
    // ── 人工调整字段 ────────────────────────────────────────────────────
    { type: 'boolean', name: 'isManualAdjusted', title: '是否已调整', defaultValue: false },
    { type: 'text',    name: 'adjustReason',   title: '调整备注' },   // DB: text
    { type: 'date',    name: 'adjustedAt',      title: '调整时间' },
    { type: 'string',  name: 'pinnedBy',        title: '调整人' },
    // NocoBase ORM 自动引用的时间戳字段（表已补建）
    { type: 'date',    name: 'createdAt',       title: '创建时间' },
    { type: 'date',    name: 'updatedAt',       title: '更新时间' },
  ],
});
