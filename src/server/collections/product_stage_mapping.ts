import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: 'product_stage_mapping',
  title: '产品工段映射',
  dumpRules: 'required',
  shared: true,
  filterTargetKey: 'id',
  fields: [
    {
      type: 'string',
      name: 'productCode',
      title: '产品编码',
    },
    {
      type: 'string',
      name: 'stageName',
      title: '工段名称',
    },
    {
      type: 'json',
      interface: 'json',
      name: 'candidateLines',
      title: '候选产线',
      description: '产线ID数组，例如 ["3F3", "3F4"]',
    },
    {
      type: 'boolean',
      name: 'isFixed',
      title: '是否唯一产线',
      defaultValue: false,
    },
    {
      type: 'string',
      name: 'remarks',
      title: '备注',
    },
  ],
  indexes: [
    {
      fields: ['productCode', 'stageName'],
    },
  ],
});
