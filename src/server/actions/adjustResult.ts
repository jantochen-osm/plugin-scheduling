/**
 * adjustResult.ts
 *
 * 人工调整排产结果 API
 *
 * 路由：POST /api/scheduling:adjustResult
 *
 * 职责：
 *   1. 接收用户提交的调整参数（产线、日期、每日产量补丁、备注）
 *   2. 验证参数合法性
 *   3. 将调整 merge 到 schedule_results_v2 对应记录
 *   4. 标记 isManualAdjusted=true, adjustedAt=NOW()
 *
 * 注意：
 *   - 调整记录在下次排产时会被覆盖（方案 A）
 *   - dailyPlanPatch 采用 merge 语义，只更新提交的日期，其他日期保留原值
 *   - chosenLine 只允许 ESG 有效产线
 */

import type { Context } from '@nocobase/actions';

/** ESG 允许的产线范围 */
const ESG_ALLOWED_LINES = ['4F1', '4F2', '4F4', '4F6'] as const;

export async function adjustResult(ctx: Context) {
  const body = ctx.action?.params?.values ?? ctx.request?.body ?? {};

  const {
    id,
    chosenLine,
    startDate,
    finishDate,
    dailyPlanPatch,
    adjustReason,
  } = body as {
    id: number;
    chosenLine?: string;
    startDate?: string;
    finishDate?: string;
    dailyPlanPatch?: Record<string, number>;
    adjustReason?: string;
  };

  // ── 1. 基础校验 ──────────────────────────────────────────────────────────
  if (!id) {
    ctx.status = 400;
    ctx.body = { error: '缺少必填参数 id' };
    return;
  }

  // 产线校验
  if (chosenLine && !(ESG_ALLOWED_LINES as readonly string[]).includes(chosenLine)) {
    ctx.status = 400;
    ctx.body = {
      error: `产线 "${chosenLine}" 不在 ESG 允许范围内（${ESG_ALLOWED_LINES.join('/')}）`,
    };
    return;
  }

  // 日期顺序校验
  if (startDate && finishDate && startDate > finishDate) {
    ctx.status = 400;
    ctx.body = { error: `开始日期 ${startDate} 不能晚于完成日期 ${finishDate}` };
    return;
  }

  // dailyPlanPatch 非负校验
  if (dailyPlanPatch) {
    for (const [date, qty] of Object.entries(dailyPlanPatch)) {
      if (typeof qty !== 'number' || qty < 0) {
        ctx.status = 400;
        ctx.body = { error: `dailyPlanPatch 中 ${date} 的产量不能为负数` };
        return;
      }
    }
  }

  // ── 2. 查询原记录 ─────────────────────────────────────────────────────────
  const repo = ctx.db.getRepository('schedule_results_v2');
  let original: any;
  try {
    original = await repo.findOne({ filterByTk: id });
  } catch (e: any) {
    ctx.status = 500;
    ctx.body = { error: '查询原记录失败: ' + (e?.message ?? String(e)) };
    return;
  }

  if (!original) {
    ctx.status = 404;
    ctx.body = { error: `未找到 id=${id} 的排产记录` };
    return;
  }

  // ── 3. 构建更新数据 ───────────────────────────────────────────────────────
  // dailyPlan：merge 原有计划与补丁（patch 优先）
  let newDailyPlan: Record<string, number> | null = null;
  if (dailyPlanPatch && Object.keys(dailyPlanPatch).length > 0) {
    const originalPlan: Record<string, number> =
      typeof original.dailyPlan === 'string'
        ? JSON.parse(original.dailyPlan || '{}')
        : (original.dailyPlan ?? {});

    newDailyPlan = { ...originalPlan, ...dailyPlanPatch };

    // 移除产量为 0 的日期（保持 dailyPlan 只含有效产量的规范）
    for (const [d, q] of Object.entries(newDailyPlan)) {
      if ((q as number) <= 0) delete newDailyPlan[d];
    }
  }

  // 重新计算 startDate / finishDate（若产量日期被修改）
  let derivedStart = startDate;
  let derivedFinish = finishDate;
  if (newDailyPlan && !startDate && !finishDate) {
    const dates = Object.keys(newDailyPlan).sort();
    if (dates.length > 0) {
      derivedStart = dates[0];
      derivedFinish = dates[dates.length - 1];
    }
  }

  // ── 4. raw SQL 更新（绕过 ORM 字段校验，保持与写入端一致）──────────────
  try {
    // 动态构建 SET 子句
    const setClauses: string[] = [];
    const replacements: Record<string, any> = { id };

    if (chosenLine !== undefined) {
      setClauses.push('"chosenLine" = :chosenLine');
      replacements.chosenLine = chosenLine;
    }
    if (derivedStart !== undefined) {
      setClauses.push('"startDate" = :startDate::date');
      replacements.startDate = derivedStart;
    }
    if (derivedFinish !== undefined) {
      setClauses.push('"finishDate" = :finishDate::date');
      replacements.finishDate = derivedFinish;
    }
    if (newDailyPlan !== null) {
      setClauses.push('"dailyPlan" = :dailyPlan::json');
      replacements.dailyPlan = JSON.stringify(newDailyPlan);
    }
    if (adjustReason !== undefined) {
      setClauses.push('"adjustReason" = :adjustReason');
      replacements.adjustReason = adjustReason ?? null;
    }

    // isManualAdjusted / adjustedAt 始终更新
    setClauses.push('"isManualAdjusted" = true');
    setClauses.push('"adjustedAt" = NOW()');

    if (setClauses.length === 2) {
      // 只有 isManualAdjusted + adjustedAt，说明没有任何实质改动
      ctx.status = 400;
      ctx.body = { error: '没有提供任何需要调整的字段' };
      return;
    }

    await ctx.db.sequelize.query(
      `UPDATE schedule_results_v2
          SET ${setClauses.join(', ')}
        WHERE id = :id`,
      { replacements },
    );

    ctx.logger?.info?.(`[AdjustResult] id=${id} updated: ${setClauses.join(', ')}`);
  } catch (e: any) {
    ctx.logger?.error?.('[AdjustResult][ERROR] ' + (e?.original?.message ?? e?.message ?? String(e)));
    ctx.status = 500;
    ctx.body = { error: '更新失败: ' + (e?.original?.message ?? e?.message ?? String(e)) };
    return;
  }

  // ── 5. 返回更新后记录 ─────────────────────────────────────────────────────
  try {
    const updated = await repo.findOne({ filterByTk: id });
    ctx.body = { success: true, data: updated };
  } catch {
    ctx.body = { success: true, data: { id } };
  }
}
