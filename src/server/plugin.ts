import { Plugin } from '@nocobase/server';
import { runScheduling } from './actions/runScheduling';
import { validateSchedule } from './actions/validateSchedule';
import { adjustResult } from './actions/adjustResult';
import { previewOrders } from './actions/previewOrders';
import { lastRun } from './actions/lastRun';
import { listRuns } from './actions/listRuns';
import { removeResults } from './actions/removeResults';
import { reScheduleAfterAdjust } from './actions/reScheduleAfterAdjust';
import { unlockAllByRunId } from './actions/unlockAllByRunId';
import { getWorkdays } from './actions/getWorkdays';
import { deleteVersion } from './actions/deleteVersion';

export class PluginSchedulingServer extends Plugin {
  async beforeLoad() {
    // 在 loadCollections() 之前补全已有表的缺失字段
    // esg_line_routing 表已存在但缺少 NocoBase ORM 默认要求的 createdAt/updatedAt
    try {
      await this.app.db.sequelize.query(
        `ALTER TABLE esg_line_routing ADD COLUMN IF NOT EXISTS "createdAt" timestamp with time zone`
      );
      await this.app.db.sequelize.query(
        `ALTER TABLE esg_line_routing ADD COLUMN IF NOT EXISTS "updatedAt" timestamp with time zone`
      );
    } catch (e: any) {
      this.app.logger?.warn?.(`[Scheduling] beforeLoad DDL skipped: ${e?.message || e}`);
    }
  }

  async install() {
    console.log('Seeding initial data for Task 1.1...');
    const db = this.app.db;

    // 1. production_stages（表可能不存在，try-catch 保护）
    try {
      const ProductionStages = db.getRepository('production_stages');
      if (ProductionStages && (await ProductionStages.count()) === 0) {
        await ProductionStages.create({
          values: [
            { stageId: 'STAGE_001', stageName: 'Assembly', stageSequence: 1, remarks: 'SMT & Assembly' },
            { stageId: 'STAGE_002', stageName: 'Package', stageSequence: 2, remarks: 'Packaging' },
          ],
        });
      }
    } catch (e: any) {
      console.log('[Scheduling] production_stages seed skipped:', e?.message || e);
    }

    // 2. customer_line_mapping（真实客户→产线映射）
    try {
      const CustomerLineMapping = db.getRepository('customer_line_mapping');
      if (CustomerLineMapping && (await CustomerLineMapping.count()) === 0) {
        await CustomerLineMapping.create({
          values: [
            { keyAccount: 'Amazon',   osmCategory: 'ESG', assignedLines: ['4F1'],  remarks: 'Amazon 标准线' },
            { keyAccount: 'Chicha',   osmCategory: 'ESG', assignedLines: ['4F2'],  remarks: 'Chicha 线（AMZ-55-/55- 前缀物料路由）' },
            { keyAccount: 'Shure',    osmCategory: 'ESG', assignedLines: ['4F4'],  remarks: 'Shure 客户线' },
            { keyAccount: 'Jano Life',osmCategory: 'ESG', assignedLines: ['4F6'],  remarks: 'Jano Life 客户线' },
          ],
        });
      }
    } catch (e: any) {
      console.log('[Scheduling] customer_line_mapping seed skipped:', e?.message || e);
    }

    // 3. calendar_exceptions
    try {
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
    } catch (e: any) {
      console.log('[Scheduling] calendar_exceptions seed skipped:', e?.message || e);
    }

    // 4. schedulable_pools
    try {
      const SchedulablePools = db.getRepository('schedulable_pools');
      if (SchedulablePools && (await SchedulablePools.count()) === 0) {
        await SchedulablePools.create({
          values: [
            { poolId: 'SC_YBSC_F3', poolName: '3F 装配池', osmCategory: 'ALL', isActive: true, sort: 1 },
            { poolId: 'SC_YBSC_HT', poolName: 'HT 装配池', osmCategory: 'ALL', isActive: true, sort: 2 },
            { poolId: 'SCD_HT_CC',  poolName: 'HT CC 池',  osmCategory: 'ALL', isActive: true, sort: 3 },
            { poolId: 'SCD_HT_F3',  poolName: 'HT F3 池',  osmCategory: 'ALL', isActive: true, sort: 4 },
          ],
        });
      }
    } catch (e: any) {
      console.log('[Scheduling] schedulable_pools seed skipped:', e?.message || e);
    }

    // 5. esg_line_routing（真实前缀路由规则）
    try {
      const ESGRouting = db.getRepository('esg_line_routing');
      if (ESGRouting && (await ESGRouting.count()) === 0) {
        await ESGRouting.create({
          values: [
            { ruleName: 'AMZ-55前缀路由', ruleType: 'PREFIX', condition: 'AMZ-55-', lines: ['4F1'], isActive: true, sort: 1, remarks: 'Amazon AMZ-55- 前缀物料路由' },
            { ruleName: '55-前缀路由',    ruleType: 'PREFIX', condition: '55-',    lines: ['4F1'], isActive: true, sort: 2, remarks: '55- 前缀物料路由' },
          ],
        });
      }
    } catch (e: any) {
      console.log('[Scheduling] esg_line_routing seed skipped:', e?.message || e);
    }

    // 6. esg_line_config（每条产线一个 item）
    try {
      const ESGLineConfig = db.getRepository('esg_line_config');
      if (ESGLineConfig && (await ESGLineConfig.count()) === 0) {
        await ESGLineConfig.create({
          values: [
            { lineCode: '4F1', type: 'standard',     color: '#ff7a45', isActive: true, sort: 1, remarks: 'Amazon 标准线' },
            { lineCode: '4F2', type: 'prefix_route', color: '#ffc53d', isActive: true, sort: 2, remarks: 'Chicha 线（AMZ-55-/55- 前缀物料路由）' },
            { lineCode: '4F4', type: 'standard',     color: '#73d13d', isActive: true, sort: 3, remarks: 'Shure 客户线' },
            { lineCode: '4F6', type: 'standard',     color: '#40a9ff', isActive: true, sort: 4, remarks: 'Jano Life 客户线' },
          ],
        });
      }
    } catch (e: any) {
      console.log('[Scheduling] esg_line_config seed skipped:', e?.message || e);
    }
  }

  async load() {
    // ── 服务启动时自动补建字段（幂等，IF NOT EXISTS）────────────────────
    // 不依赖 API 首次调用，确保服务启动即可用
    const ddlStatements = [
      // ── ESG 产线配置表（如不存在则创建）────────────────────────────────
      `CREATE TABLE IF NOT EXISTS esg_line_config (
        id SERIAL PRIMARY KEY,
        "lineCode" VARCHAR(50) UNIQUE NOT NULL,
        type VARCHAR(20) DEFAULT 'standard',
        color VARCHAR(20) DEFAULT '#40a9ff',
        "isActive" BOOLEAN DEFAULT true,
        sort INTEGER DEFAULT 0,
        remarks TEXT,
        "createdAt" TIMESTAMP WITH TIME ZONE,
        "updatedAt" TIMESTAMP WITH TIME ZONE
      )`,
      `CREATE TABLE IF NOT EXISTS esg_line_routing (
        id SERIAL PRIMARY KEY,
        "ruleName" VARCHAR(100),
        "ruleType" VARCHAR(20),
        condition VARCHAR(200),
        lines JSONB,
        "isActive" BOOLEAN DEFAULT true,
        sort INTEGER DEFAULT 0,
        remarks TEXT,
        "createdAt" TIMESTAMP WITH TIME ZONE,
        "updatedAt" TIMESTAMP WITH TIME ZONE
      )`,
      // ── 补全已有表的缺失字段 ──────────────────────────────────────────
      // esg_line_routing 表已存在但缺少 createdAt/updatedAt（NocoBase ORM 默认引用）
      `ALTER TABLE esg_line_routing ADD COLUMN IF NOT EXISTS "createdAt" timestamp with time zone`,
      `ALTER TABLE esg_line_routing ADD COLUMN IF NOT EXISTS "updatedAt" timestamp with time zone`,
      // ── 现有字段补建 ──────────────────────────────────────────────────
      `ALTER TABLE schedule_results_v2 ADD COLUMN IF NOT EXISTS "pinnedBy" varchar(100)`,
      `ALTER TABLE schedule_runs ADD COLUMN IF NOT EXISTS "runType" varchar(20) DEFAULT 'FULL'`,
      `ALTER TABLE schedule_runs ADD COLUMN IF NOT EXISTS "pinnedCount" integer DEFAULT 0`,
      `ALTER TABLE schedule_runs ADD COLUMN IF NOT EXISTS "reScheduledCount" integer DEFAULT 0`,
      // NocoBase ORM 对所有 Collection 自动引用 createdAt/updatedAt，
      // 此表由 raw SQL 创建时缺少这两列，导致 list API 报 "Invalid SQL column or table reference"
      `ALTER TABLE schedule_results_v2 ADD COLUMN IF NOT EXISTS "createdAt" timestamp with time zone`,
      `ALTER TABLE schedule_results_v2 ADD COLUMN IF NOT EXISTS "updatedAt" timestamp with time zone`,
      // ── 版本管理新增字段（strategy / startDate / versionName）─────────────
      `ALTER TABLE schedule_runs ADD COLUMN IF NOT EXISTS strategy VARCHAR(20) DEFAULT ''`,
      `ALTER TABLE schedule_runs ADD COLUMN IF NOT EXISTS "startDate" VARCHAR(20) DEFAULT ''`,
      `ALTER TABLE schedule_runs ADD COLUMN IF NOT EXISTS "versionName" VARCHAR(200) DEFAULT ''`,
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
        unlockAllByRunId,      // 批量解锁指定版本内的所有手工调整记录
        workdays: getWorkdays,  // 查询工作日历（前端按日期自动计算每日产量）
        deleteVersion,          // 删除指定版本的排产结果
      },
    });

    // ── 开放权限 ───────────────────────────────────────────────────────
    this.app.acl.allow(
      'scheduling',
      ['run', 'validate', 'adjustResult', 'previewOrders',
       'lastRun', 'listRuns', 'removeResults', 'reScheduleAfterAdjust', 'workdays',
       'unlockAllByRunId', 'deleteVersion'],
      'loggedIn',
    );
    this.app.acl.allow('schedule_runs', ['list', 'get'], 'loggedIn');
    this.app.acl.allow('schedule_results_v2', ['list', 'get', 'update'], 'loggedIn');
    this.app.acl.allow('schedule_exceptions_v2', ['list', 'get'], 'loggedIn');
    // 订单选择 UI 需要读取订单列表
    this.app.acl.allow('dn_production_order_ds', ['list', 'get'], 'loggedIn');
    // 「按日期自动计算」功能需要读取工作日历
    this.app.acl.allow('md_work_calendars', ['list', 'get'], 'loggedIn');
    // 可排产订单池配置
    this.app.acl.allow('schedulable_pools', ['list', 'get'], 'loggedIn');
    // ESG 产线路由规则
    this.app.acl.allow('esg_line_routing', ['list', 'get'], 'loggedIn');
    // ESG 产线配置
    this.app.acl.allow('esg_line_config', ['list', 'get'], 'loggedIn');
  }
}

export default PluginSchedulingServer;
