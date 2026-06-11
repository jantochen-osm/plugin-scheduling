/**
 * unlockAllByRunId.ts
 *
 * 批量解锁当前版本内的所有手工调整记录
 *
 * 路由：POST /api/scheduling:unlockAllByRunId
 *
 * 入参：
 *   - runId: string
 *
 * 职责：
 *   1. 仅在指定 runId 范围内查找 isManualAdjusted=true 的记录
 *   2. 批量清空这些记录的锁定字段
 *   3. 返回解锁数量，供前端提示
 */

import type { Context } from '@nocobase/actions';

export async function unlockAllByRunId(ctx: Context) {
  const body = ctx.action?.params?.values ?? ctx.request?.body ?? {};
  const runId: string = body.runId;

  if (!runId) {
    ctx.status = 400;
    ctx.body = { error: 'runId is required for unlockAllByRunId' };
    return;
  }

  try {
    const [rows] = await ctx.db.sequelize.query(
      `SELECT id
         FROM schedule_results_v2
        WHERE "runId" = :runId
          AND "isManualAdjusted" = true`,
      { replacements: { runId } },
    ) as any;

    const ids = Array.isArray(rows) ? rows.map((row: any) => row.id).filter(Boolean) : [];

    if (ids.length === 0) {
      ctx.body = { success: true, runId, unlockedCount: 0 };
      return;
    }

    const idPlaceholders = ids.map((_, index) => `:id${index}`);
    const idReplacements = ids.reduce<Record<string, any>>((acc, id, index) => {
      acc[`id${index}`] = id;
      return acc;
    }, { runId });

    await ctx.db.sequelize.query(
      `UPDATE schedule_results_v2
          SET "isManualAdjusted" = false,
              "adjustedAt" = NULL,
              "adjustReason" = NULL,
              "pinnedBy" = NULL
        WHERE id IN (${idPlaceholders.join(', ')})`,
      { replacements: idReplacements },
    );

    ctx.body = { success: true, runId, unlockedCount: ids.length };
  } catch (e: any) {
    ctx.logger?.error?.('[UnlockAllByRunId][ERROR] ' + (e?.original?.message ?? e?.message ?? String(e)));
    ctx.status = 500;
    ctx.body = { error: '批量解锁失败: ' + (e?.original?.message ?? e?.message ?? String(e)) };
  }
}