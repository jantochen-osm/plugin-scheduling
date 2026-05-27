import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: 'production_stages',
  title: '生产工段',
  dumpRules: 'required',
  shared: true,
  filterTargetKey: 'id',
  fields: [
    {
      type: 'string',
      name: 'stageId',
      title: '工段ID',
    },
    {
      type: 'string',
      name: 'stageName',
      title: '工段名称',
    },
    {
      type: 'integer',
      name: 'stageSequence',
      title: '工段顺序',
    },
    {
      type: 'string',
      name: 'remarks',
      title: '备注',
    },
  ],
  indexes: [
    {
      fields: ['stageName'],
    },
  ],
});
