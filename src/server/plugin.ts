import { Plugin } from '@nocobase/server';
import { runScheduling } from './actions/runScheduling';
import { validateSchedule } from './actions/validateSchedule';
import { adjustResult } from './actions/adjustResult';

export class PluginSchedulingServer extends Plugin {
  async beforeLoad() {
    // Collections (production_stages, customer_line_mapping,
    // calendar_exceptions) are created via NocoBase admin UI or REST API.
    // They are NOT registered here via db.import() to ensure they appear in the
    // admin collection manager as user-managed collections.
    //
    // To create them: POST /api/collections:create with the collection schema.
    // See src/server/collections/*.ts for field definitions.
  }

  async install() {
    console.log('Seeding initial data for Task 1.1...');
    const db = this.app.db;
    
    // 1. production_stages
    const ProductionStages = db.getRepository('production_stages');
    if (ProductionStages && (await ProductionStages.count()) === 0) {
      await ProductionStages.create({
        values: [
          { stageId: 'STAGE_001', stageName: 'Assembly', stageSequence: 1, remarks: 'SMT & Assembly' },
          { stageId: 'STAGE_002', stageName: 'Package', stageSequence: 2, remarks: 'Packaging' },
        ],
      });
    }

    // 2. customer_line_mapping
    const CustomerLineMapping = db.getRepository('customer_line_mapping');
    if (CustomerLineMapping && (await CustomerLineMapping.count()) === 0) {
      await CustomerLineMapping.create({
        values: [
          { keyAccount: 'CUST_A', osmCategory: 'ESG', assignedLines: ['ESG_LINE_1'] },
          { keyAccount: 'CUST_B', osmCategory: 'ESG', assignedLines: ['ESG_LINE_1', 'ESG_LINE_2'] },
        ],
      });
    }

    // 3. calendar_exceptions
    const CalendarExceptions = db.getRepository('calendar_exceptions');
    if (CalendarExceptions && (await CalendarExceptions.count()) === 0) {
      await CalendarExceptions.create({
        values: [
          { exceptionDate: '2026-06-01', exceptionType: 'HOLIDAY', affectedLines: null, workHours: 0, setupTime: 0, remarks: 'Childrens Day' },
          { exceptionDate: '2026-06-05', exceptionType: 'MAINTENANCE', affectedLines: ['3F3'], workHours: 8, setupTime: 0, remarks: 'Monthly maintenance' },
          { exceptionDate: '2026-06-06', exceptionType: 'CHANGEOVER', affectedLines: ['1F1'], workHours: 10, setupTime: 120, remarks: 'Product switch' },
        ],
      });
    }
  }

  async load() {
    // 注册排产 API 端点
    this.app.resourceManager.define({
      name: 'scheduling',
      actions: {
        run: runScheduling,
        validate: validateSchedule,
        adjustResult,  // 人工调整排产结果
      },
    });

    // 开放权限（loggedIn 即可；角色细化由 NocoBase 管理界面配置）
    this.app.acl.allow('scheduling', ['run', 'validate', 'adjustResult'], 'loggedIn');
    this.app.acl.allow('schedule_runs', ['list', 'get'], 'loggedIn');
    this.app.acl.allow('schedule_results_v2', ['list', 'get', 'update'], 'loggedIn');
    this.app.acl.allow('schedule_exceptions_v2', ['list', 'get'], 'loggedIn');
  }
}

export default PluginSchedulingServer;
