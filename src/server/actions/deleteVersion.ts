/**
 * deleteVersion.ts
 *
 * 删除指定排产版本的全部数据。
 *
 * 路由：POST /api/scheduling:deleteVersion
 * Body：{ runId: string }
 *
 * 删除范围：
 *   - schedule_results_v2   WHERE runId = :runId
 *   - schedule_exceptions_v2 WHERE runId = :runId（如存在）
 *   - schedule_runs          WHERE runId = :runId
 */

import type { Context } from '@nocobase/actions';

export async function deleteVersion(ctx: Context) {
  const body = ctx.action?.params?.values ?? ctx.request?.body ?? {};
  const runId: string = body.runId;

  if (!runId) {
    ctx.status = 400;
    ctx.body = { error: 'runId is required' };
    return;
  }

  try {
    // 1. 删除排产结果
    const [, resultMeta] = await ctx.db.sequelize.query(
      `DELETE FROM schedule_results_v2 WHERE "runId" = :runId`,
      { replacements: { runId } },
    ) as any;
    const deletedResults = resultMeta?.rowCount ?? 0;
    ctx.logger?.info?.(`[deleteVersion] Deleted ${deletedResults} results for runId=${runId}`);

    // 2. 删除排产异常（表可能不存在，静默忽略）
    try {
      await ctx.db.sequelize.query(
        `DELETE FROM schedule_exceptions_v2 WHERE "runId" = :runId`,
        { replacements: { runId } },
      );
    } catch {
      // 表不存在时静默跳过
    }

    // 3. 删除运行记录
    await ctx.db.sequelize.query(
      `DELETE FROM schedule_runs WHERE "runId" = :runId`,
      { replacements: { runId } },
    );
    ctx.logger?.info?.(`[deleteVersion] Deleted schedule_runs record for runId=${runId}`);

    ctx.body = { success: true, runId, deletedResults };
  } catch (e: any) {
    ctx.logger?.error?.('[deleteVersion][ERROR] ' + (e?.original?.message ?? e?.message ?? String(e)));
    ctx.status = 500;
    ctx.body = { error: '删除版本失败：' + (e?.original?.message ?? e?.message ?? String(e)) };
  }
}
