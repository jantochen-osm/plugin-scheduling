import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: 'schedule_exceptions',
  title: '排产异常',
  filterTargetKey: 'id',
  fields: [
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
    {
      type: 'string',
      name: 'exceptionType',
      title: '异常类型',
    },
    {
      type: 'string',
      name: 'severity',
      title: '严重程度',
    },
    {
      type: 'text',
      name: 'message',
      title: '异常描述',
    },
  ],
});
