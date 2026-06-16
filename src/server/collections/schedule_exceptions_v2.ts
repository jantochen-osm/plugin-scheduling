import { defineCollection } from '@nocobase/database';

/**
 * schedule_exceptions_v2 Collection 定义
 *
 * 排产异常明细表，由 runScheduling / validateSchedule 写入。
 * 表由 raw SQL 创建，此处注册字段供 NocoBase list API 正确返回。
 */
export default defineCollection({
  name: 'schedule_exceptions_v2',
  title: '排产异常 v2',
  filterTargetKey: 'id',
  syncOptions: { alter: false, force: false },
  fields: [
    { type: 'string',  name: 'runId',          title: '排产运行ID' },
    { type: 'string',  name: 'prodId',         title: '生产单号' },
    { type: 'string',  name: 'itemId',         title: '成品编码' },
    { type: 'string',  name: 'exceptionType',  title: '异常类型' },
    { type: 'string',  name: 'severity',       title: '严重程度' },
    { type: 'text',    name: 'message',        title: '异常描述' },
  ],
});
