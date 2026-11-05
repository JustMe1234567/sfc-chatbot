import type { Store } from "./types";

/**
 * The Trash retention rule (ticket 58): a trashed answer is purged forever
 * 30 days after it entered Trash. The period is fixed for answer rules and
 * deliberately separate from the configurable conversation transcript
 * retention — deleting answers is not an archive policy.
 */
export const TRASH_RETENTION_DAYS = 30;

export interface TrashSweepResult {
  purgedAnswers: number;
}

/**
 * Permanently removes every answer whose 30 days in Trash have passed. The
 * maintenance route runs this at its next scheduled pass on or after the
 * threshold; restoring a trashed answer beforehand cancels its expiry
 * (restore clears the trashedAt stamp), so only rules still sitting in
 * Trash past the cutoff are eligible. Reruns are safe — nothing removed
 * means nothing counted — and active or archived answers are never touched:
 * eligibility is status `trashed` alone, the same boundary that keeps every
 * non-published status away from visitors.
 */
export async function purgeExpiredTrash(
  store: Store,
  now: Date = new Date(),
): Promise<TrashSweepResult> {
  const cutoff = new Date(
    now.getTime() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const rules = await store.listAnswerRules();
  let purgedAnswers = 0;
  for (const rule of rules) {
    if (rule.status === "trashed" && rule.trashedAt !== null && rule.trashedAt <= cutoff) {
      await store.deleteAnswerRule(rule.id);
      purgedAnswers += 1;
    }
  }
  return { purgedAnswers };
}

/**
 * The request-facing wrapper (the transcript sweep's pattern): cleanup rides
 * ordinary staff traffic and the cron alike, so a failing purge must never
 * take the endpoint down — the next pass retries.
 */
export async function sweepExpiredTrash(
  store: Store,
  now: Date = new Date(),
): Promise<TrashSweepResult | null> {
  try {
    return await purgeExpiredTrash(store, now);
  } catch (error) {
    console.error("trash purge failed:", error);
    return null;
  }
}
