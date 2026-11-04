import type { AppDatabase } from "../db/appDatabase";
import { DEFAULT_RETENTION_DAYS, readTranscriptRetention } from "../settings";
import type { RetentionRun, Store } from "./types";

export interface RetentionSweepResult {
  removedConversations: number;
}

/**
 * Removes every closed conversation whose retention period has passed, along
 * with its transcript and visitor contact details (ticket 10, amended by
 * ticket 47). The clock runs from a conversation's closure — active
 * conversations are never eligible — and while no owner period is configured
 * the default of 30 days applies, so an installation that never configured
 * anything still sheds transcripts older than that (the recorded upgrade
 * decision: no grandfathering). A corrupt stored value refuses the sweep
 * entirely and returns null: retention must never delete on the strength of
 * a bad value. A run that removes nothing records nothing — the operator's
 * cleanup history lists actual removals, and reruns stay free.
 */
export async function runRetentionSweep(
  db: AppDatabase,
  store: Store,
  now: Date = new Date(),
): Promise<RetentionSweepResult | null> {
  const setting = await readTranscriptRetention(db);
  if (setting.kind === "invalid") {
    console.error(
      "transcript retention setting is not a valid period; sweep skipped:",
      setting.raw.slice(0, 64),
    );
    return null;
  }
  const retentionDays = setting.kind === "set" ? setting.days : DEFAULT_RETENTION_DAYS;
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const expired = await store.listConversationsClosedBefore(cutoff);
  let removedConversations = 0;
  for (const conversation of expired) {
    if (await store.purgeClosedConversation(conversation.id)) {
      removedConversations += 1;
    }
  }
  if (removedConversations > 0) {
    const run: RetentionRun = {
      id: crypto.randomUUID(),
      ranAt: now.toISOString(),
      retentionDays,
      removedConversations,
    };
    await store.recordRetentionRun(run);
  }
  return { removedConversations };
}

/**
 * The request-facing wrapper: cleanup rides ordinary staff traffic, so a
 * failing sweep must never take the inbox or the settings save down with it.
 */
export async function sweepTranscripts(
  db: AppDatabase,
  store: Store,
  now: Date = new Date(),
): Promise<RetentionSweepResult | null> {
  try {
    return await runRetentionSweep(db, store, now);
  } catch (error) {
    console.error("retention sweep failed:", error);
    return null;
  }
}

/** The most recent cleanup that removed something, for the operator's page. */
export function latestRetentionRun(store: Store): Promise<RetentionRun | null> {
  return store.getLatestRetentionRun();
}
