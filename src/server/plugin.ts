import { Plugin } from '@nocobase/server';
import { runScheduling } from './actions/runScheduling';
import { validateSchedule } from './actions/validateSchedule';
import { adjustResult } from './actions/adjustResult';
import { previewOrders } from './actions/previewOrders';
import { lastRun } from './actions/lastRun';
import { listRuns } from './actions/listRuns';
import { removeResults } from './actions/removeResults';
import { reScheduleAfterAdjust } from './actions/reScheduleAfterAdjust';
import { getWorkdays } from './actions/getWorkdays';

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
    // ── 服务启动时自动补建字段（幂等，IF NOT EXISTS）────────────────────
    // 不依赖 API 首次调用，确保服务启动即可用
    const ddlStatements = [
      `ALTER TABLE schedule_results_v2 ADD COLUMN IF NOT EXISTS "pinnedBy" varchar(100)`,
      `ALTER TABLE schedule_runs ADD COLUMN IF NOT EXISTS "runType" varchar(20) DEFAULT 'FULL'`,
      `ALTER TABLE schedule_runs ADD COLUMN IF NOT EXISTS "pinnedCount" integer DEFAULT 0`,
      `ALTER TABLE schedule_runs ADD COLUMN IF NOT EXISTS "reScheduledCount" integer DEFAULT 0`,
      // NocoBase ORM 对所有 Collection 自动引用 createdAt/updatedAt，
      // 此表由 raw SQL 创建时缺少这两列，导致 list API 报 "Invalid SQL column or table reference"
      `ALTER TABLE schedule_results_v2 ADD COLUMN IF NOT EXISTS "createdAt" timestamp with time zone`,
      `ALTER TABLE schedule_results_v2 ADD COLUMN IF NOT EXISTS "updatedAt" timestamp with time zone`,
    ];
    for (const sql of ddlStatements) {
      try {
        await this.app.db.sequelize.query(sql);
      } catch (e: any) {
        // 字段已存在或表不存在时静默忽略
        this.app.logger?.warn?.(`[Scheduling] DDL skipped: ${sql.slice(0, 60)}… (${e?.message || e})`);
      }
    }

    // ── 注册排产 API 端点 ──────────────────────────────────────────────
    this.app.resourceManager.define({
      name: 'scheduling',
      actions: {
        run:                   runScheduling,
        validate:              validateSchedule,
        adjustResult,          // 人工调整排产结果
        previewOrders,         // 订单选择预览（无副作用）
        lastRun,               // 最近一次运行摘要（raw SQL，绕过 ORM 字段校验）
        listRuns,              // 排产历史列表（分页，raw SQL）
        removeResults,         // 撤销指定订单的排产结果
        reScheduleAfterAdjust, // 调整后重计算（保留锁定记录，仅重排未锁定订单）
        workdays: getWorkdays,  // 查询工作日历（前端按日期自动计算每日产量）
      },
    });

    // ── 开放权限 ───────────────────────────────────────────────────────
    this.app.acl.allow(
      'scheduling',
      ['run', 'validate', 'adjustResult', 'previewOrders',
       'lastRun', 'listRuns', 'removeResults', 'reScheduleAfterAdjust', 'workdays'],
      'loggedIn',
    );
    this.app.acl.allow('schedule_runs', ['list', 'get'], 'loggedIn');
    this.app.acl.allow('schedule_results_v2', ['list', 'get', 'update'], 'loggedIn');
    this.app.acl.allow('schedule_exceptions_v2', ['list', 'get'], 'loggedIn');
    // 订单选择 UI 需要读取订单列表
    this.app.acl.allow('dn_production_order_ds', ['list', 'get'], 'loggedIn');
    // 「按日期自动计算」功能需要读取工作日历
    this.app.acl.allow('md_work_calendars', ['list', 'get'], 'loggedIn');
  }
}

export default PluginSchedulingServer;
