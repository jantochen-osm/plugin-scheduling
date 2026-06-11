/**
 * scheduling/preOccupy.ts
 *
 * Pinned Results Pre-Occupation.
 *
 * Called in reScheduleAfterAdjust after initialising the capacity pool but
 * before scheduleAll runs.  It allocates the capacity already committed by
 * locked records (isManualAdjusted=true) into the capacity pool so the
 * scheduler cannot double-book those slots.
 *
 * Design decision: This module ONLY pre-occupies capacity.
 * It does NOT update lineLastFinish / lineLastItem.
 *
 * Reason: if we set lineLastFinish[line] to the locked order's last date,
 * every non-pinned order targeting that line is pushed to start AFTER the
 * locked order -- potentially BEYOND the capacity pool's end date (today +
 * maxDays).  When that happens, tryScheduleStage finds zero available
 * capacity and the order produces no result, causing it to silently
 * disappear from the Gantt.
 *
 * The safer behaviour is to let non-pinned orders compete freely for
 * whatever capacity slots are left in the pool.  The pre-occupation already
 * prevents double-booking: the scheduler will naturally skip days that are
 * already fully consumed by the locked order and fill in the remaining gaps.
 * The schedule may look "fragmented" but no orders will be lost.
 *
 * lineLastFinish / lineLastItem are maintained exclusively by the scheduleAll
 * main loop as it commits each non-pinned result.
 */

import { CapacityPool } from '../../engines';

/**
 * Pre-occupy locked records in the capacity pool.
 *
 * @param pinnedResults   Records where isManualAdjusted=true
 * @param capacityPool    Initialised capacity pool (step5 output)
 * @param lineLastFinish  NOT written by this function (signature kept for caller compatibility)
 * @param lineLastItem    NOT written by this function (signature kept for caller compatibility)
 */
export function preOccupyPinnedResults(
  pinnedResults: any[],
  capacityPool: CapacityPool,
  lineLastFinish: Record<string, string>,   // kept for API compatibility, not written
  lineLastItem: Record<string, string>,     // kept for API compatibility, not written
): void {
  // Explicitly unused -- non-pinned orders start from today and compete freely
  // for whatever capacity the locked orders leave behind.
  void lineLastFinish;
  void lineLastItem;

  for (const r of pinnedResults) {
    const line = r.chosenLine;
    if (!line) continue;

    const uph = Number(r.uph) || 1;
    const dailyPlan: Record<string, number> =
      typeof r.dailyPlan === 'string'
        ? JSON.parse(r.dailyPlan || '{}')
        : (r.dailyPlan || {});

    // Allocate every production day of the locked order into the capacity pool.
    // This prevents the scheduler from assigning the same slot to a non-pinned order.
    for (const [date, qty] of Object.entries(dailyPlan)) {
      const hours = (qty as number) / uph;
      if (hours > 0) capacityPool.allocate(line, date, hours);
    }
  }

  // Clear the skipped list (no historical skip logic in this version)
  (preOccupyPinnedResults as any)._lastSkipped = [];
}
