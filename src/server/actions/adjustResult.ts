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
 *   4. 标记 isManualAdjusted=true, adjustedAt=NOW(), pinnedBy=currentUser
 *
 * 新增参数：
 *   - unlock        : true → 撤销锁定（isManualAdjusted=false，清空调整字段）
 *   - autoReSchedule: true → 调整保存后自动触发 reScheduleAfterAdjust 重算
 *
 * 注意：
 *   - dailyPlanPatch 采用 merge 语义，只更新提交的日期，其他日期保留原值
 *   - chosenLine 只允许 ESG 有效产线
 *   - unlock 与其他调整字段互斥，unlock=true 时忽略其他字段
 */

import type { Context } from '@nocobase/actions';
import { reScheduleAfterAdjust } from './reScheduleAfterAdjust';

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
    unlock,
    autoReSchedule,
  } = body as {
    id: number;
    chosenLine?: string;
    startDate?: string;
    finishDate?: string;
    dailyPlanPatch?: Record<string, number>;
    adjustReason?: string;
    /** true → 撤销锁定，清空 isManualAdjusted / adjustedAt / adjustReason / pinnedBy */
    unlock?: boolean;
    /** true → 调整保存后自动触发 reScheduleAfterAdjust */
    autoReSchedule?: boolean;
  };

  // ── 1. 基础校验 ──────────────────────────────────────────────────────────
  if (!id) {
    ctx.status = 400;
    ctx.body = { error: '缺少必填参数 id' };
    return;
  }

  // ── 1.5 unlock 分支（最优先，与调整逻辑互斥）─────────────────────────────
  if (unlock === true) {
    try {
      await ctx.db.sequelize.query(
        `UPDATE schedule_results_v2
            SET "isManualAdjusted" = false,
                "adjustedAt"       = NULL,
                "adjustReason"     = NULL,
                "pinnedBy"         = NULL
          WHERE id = :id`,
        { replacements: { id } },
      );
      ctx.logger?.info?.(`[AdjustResult] id=${id} unlocked`);
      ctx.body = { success: true, message: '已解锁，下次重算时将重新计算此订单' };
    } catch (e: any) {
      ctx.logger?.error?.('[AdjustResult][Unlock][ERROR] ' + (e?.original?.message ?? e?.message ?? String(e)));
      ctx.status = 500;
      ctx.body = { error: '解锁失败: ' + (e?.original?.message ?? e?.message ?? String(e)) };
    }
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

  // ── 历史日期检测（不阻断，响应附 warnings 供前端提示）────────────────────
  const _warnings: string[] = [];
  const todayStr = new Date().toISOString().split('T')[0];
  if (dailyPlanPatch) {
    const newDates = Object.entries(dailyPlanPatch)
      .filter(([, qty]) => (qty as number) > 0)
      .map(([d]) => d);
    const latestNewDate = newDates.sort().at(-1);
    if (latestNewDate && latestNewDate < todayStr) {
      _warnings.push(
        `⚠️ 调整的排产日期（${latestNewDate}）早于今天（${todayStr}）。` +
        '锁定历史日期后重算可能导致后续订单排产结果异常，建议使用今天或未来的日期。',
      );
      ctx.logger?.warn?.(`[AdjustResult] id=${id} adjusted to historical date ${latestNewDate}`);
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

  // 重新计算 startDate / finishDate
  // 规则：
  //   - 若 dailyPlan 被修改（newDailyPlan 非 null），startDate/finishDate 必须
  //     从 newDailyPlan 的日期键推导，忽略前端传来的旧日期值。
  //     这样可以保证 finishDate 与 dailyPlan 中的实际最晚产量日期始终一致。
  //   - 若 dailyPlan 未修改但用户单独传了 startDate/finishDate，则使用用户传值。
  let derivedStart = startDate;
  let derivedFinish = finishDate;
  if (newDailyPlan) {
    // dailyPlan 已更新 → 从日期键重新推导，覆盖任何前端传入的日期
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

    // pinnedBy：记录调整人（取当前登录用户的 nickname，兜底 username）
    const currentUser = (ctx.state as any)?.currentUser;
    const pinnedBy: string | null =
      currentUser?.nickname || currentUser?.username || null;
    setClauses.push('"pinnedBy" = :pinnedBy');
    replacements.pinnedBy = pinnedBy;

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

  // ── 5. autoReSchedule：保存后立即触发重算 ───────────────────────────────
  if (autoReSchedule === true) {
    ctx.logger?.info?.(`[AdjustResult] id=${id} autoReSchedule triggered`);
    try {
      // 复用 reScheduleAfterAdjust 核心逻辑（直接调函数，不走 HTTP 回路）
      // 注入 strategy=ESG：Gantt 组件只管 ESG 产线，不触发 EE 排产
      const origValues = ctx.action?.params?.values ?? {};
      if (ctx.action?.params) {
        ctx.action.params.values = { ...origValues, strategy: 'ESG' };
      }
      const savedBody = ctx.body;
      await reScheduleAfterAdjust(ctx);
      // 还原 params（避免影响后续逻辑）
      if (ctx.action?.params) {
        ctx.action.params.values = origValues;
      }
      // 将重算结果合并到响应中
      const reScheduleResult = ctx.body;
      ctx.body = {
        success: true,
        data: savedBody?.data ?? { id },
        reSchedule: reScheduleResult,
      };
      return;
    } catch (e: any) {
      ctx.logger?.error?.('[AdjustResult][AutoReSchedule][ERROR] ' + (e?.message ?? String(e)));
      // 重算失败不阻塞调整结果，继续返回调整成功
    }
  }

  // ── 6. 返回更新后记录 ─────────────────────────────────────────────────────
  try {
    const updated = await repo.findOne({ filterByTk: id });
    ctx.body = {
      success: true,
      data: updated,
      ..._warnings.length > 0 ? { warnings: _warnings } : {},
    };
  } catch {
    ctx.body = {
      success: true,
      data: { id },
      ..._warnings.length > 0 ? { warnings: _warnings } : {},
    };
  }
}
