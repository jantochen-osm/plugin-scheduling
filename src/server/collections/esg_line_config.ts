import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: 'esg_line_config',
  title: 'ESG 产线配置',
  dumpRules: 'required',
  shared: true,
  filterTargetKey: 'lineCode',
  fields: [
    {
      type: 'string',
      name: 'lineCode',
      title: '产线代码',
      unique: true,
    },
    {
      type: 'string',
      name: 'type',
      title: '产线类型',
      defaultValue: 'standard',
      // standard | prefix_route | trial
    },
    {
      type: 'string',
      name: 'color',
      title: '显示颜色',
      defaultValue: '#40a9ff',
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
    { fields: ['lineCode'] },
    { fields: ['sort'] },
  ],
});
