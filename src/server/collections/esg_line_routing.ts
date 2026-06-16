import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: 'esg_line_routing',
  title: 'ESG 产线路由规则',
  dumpRules: 'required',
  shared: true,
  filterTargetKey: 'id',
  fields: [
    {
      type: 'string',
      name: 'ruleName',
      title: '规则名称',
    },
    {
      type: 'string',
      name: 'ruleType',
      title: '规则类型',
      // PRODID | PREFIX
    },
    {
      type: 'string',
      name: 'condition',
      title: '匹配条件',
    },
    {
      type: 'json',
      interface: 'json',
      name: 'lines',
      title: '目标产线',
      description: '产线代码数组，例如 ["4F2"]',
    },
    {
      type: 'boolean',
      name: 'isActive',
      title: '启用',
      defaultValue: true,
    },
    {
      type: 'integer',
      name: 'sort',
      title: '排序',
      defaultValue: 0,
    },
    {
      type: 'string',
      name: 'remarks',
      title: '备注',
    },
  ],
  indexes: [
    { fields: ['sort'] },
  ],
});
