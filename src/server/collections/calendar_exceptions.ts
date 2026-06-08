import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: 'calendar_exceptions',
  title: '日历异常',
  dumpRules: 'required',
  shared: true,
  filterTargetKey: 'id',
  fields: [
    {
      type: 'date',
      name: 'exceptionDate',
      title: '异常日期',
    },
    {
      type: 'string',
      name: 'exceptionType',
      title: '异常类型',
      // MAINTENANCE（设备保养）/ CHANGEOVER（换线）/ EXTRA_WORKDAY（补班日）
    },
    {
      type: 'json',
      interface: 'json',
      name: 'affectedLines',
      title: '影响产线',
      description: '为 null 表示全线，否则为产线数组',
    },
    {
      type: 'float',
      name: 'workHours',
      title: '工作时数',
      description: '0 = 停工，其他数值为部分停工',
    },
    {
      type: 'integer',
      name: 'setupTime',
      title: '换线耗时',
      description: '单位：分钟',
    },
    {
      type: 'string',
      name: 'remarks',
      title: '备注',
    },
  ],
  indexes: [
    {
      fields: ['exceptionDate'],
    },
  ],
});
