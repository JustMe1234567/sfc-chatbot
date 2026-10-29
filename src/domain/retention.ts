import type { AppDatabase } from "../db/appDatabase";
import { getTranscriptRetentionDays } from "../settings";
import type { RetentionRun, Store } from "./types";

export interface RetentionSweepResult {
  removedConversations: number;
}

/**
 * Removes every closed conversation whose retention period has passed, along
 * with its transcript and visitor contact details (ticket 10). Unconfigured
 * retention disables the sweep entirely: null comes back and nothing is
 * touched, so a missing setting can never delete a transcript. A run that
 * removes nothing records nothing — the operator's cleanup history lists
 * actual removals, and reruns stay free.
 */
export async function runRetentionSweep(
  db: AppDatabase,
  store: Store,
  now: Date = new Date(),
): Promise<RetentionSweepResult | null> {
  const retentionDays = await getTranscriptRetentionDays(db);
  if (retentionDays === null) {
    return null;
  }
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
