/**
 * listRuns.ts
 *
 * 返回排产运行历史记录（分页）。
 * 路由：GET /api/scheduling:listRuns?page=1&pageSize=10
 *
 * 直接用 raw SQL 查询，绕过 NocoBase ORM 对 schedule_runs 的字段校验问题。
 */
import type { Context } from '@nocobase/actions';
export declare function listRuns(ctx: Context): Promise<void>;
