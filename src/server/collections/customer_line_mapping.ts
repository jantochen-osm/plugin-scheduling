import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: 'customer_line_mapping',
  title: '客户产线映射',
  dumpRules: 'required',
  shared: true,
  filterTargetKey: 'id',
  fields: [
    {
      type: 'string',
      name: 'keyAccount',
      title: '客户名称',
    },
    {
      type: 'string',
      name: 'osmCategory',
      title: '分类',
      defaultValue: 'ESG',
    },
    {
      type: 'json',
      interface: 'json',
      name: 'assignedLines',
      title: '分配产线',
      description: '产线ID数组，例如 ["ESG_LINE_1"]',
    },
    {
      type: 'string',
      name: 'remarks',
      title: '备注',
    },
  ],
  indexes: [
    {
      fields: ['keyAccount'],
    },
  ],
});
