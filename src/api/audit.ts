import type { AppDatabase } from "../db/appDatabase";
import { staffName } from "@/api/staffConversations";
import type { AuditEntry, Store } from "@/domain/types";

export interface AuditView extends AuditEntry {
  actorName: string | null;
}

/** The trail with display names resolved from the staff account table. */
export async function auditWithNames(db: AppDatabase, entries: AuditEntry[]): Promise<AuditView[]> {
  return Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      actorName: await staffName(db, entry.actorId),
    })),
  );
}

/**
 * Records one security-sensitive staff action for the accountability trail
 * (ticket 08). Called after the action itself succeeds; the actor is always
 * the authenticated staff member whose request caused it.
 */
export async function audit(
  store: Store,
  actorId: string,
  action: AuditEntry["action"],
  scope: { conversationId?: string; ruleId?: string } = {},
  detail: string | null = null,
): Promise<void> {
  await store.recordAudit({
    id: crypto.randomUUID(),
    conversationId: scope.conversationId ?? null,
    ruleId: scope.ruleId ?? null,
    actorId,
    action,
    detail,
    createdAt: new Date().toISOString(),
  });
}
