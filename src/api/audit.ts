import type { DatabaseSync } from "node:sqlite";
import { staffName } from "@/api/staffConversations";
import type { AuditEntry, Store } from "@/domain/types";

export interface AuditView extends AuditEntry {
  actorName: string | null;
}

/** The trail with display names resolved from the staff account table. */
export function auditWithNames(db: DatabaseSync, entries: AuditEntry[]): AuditView[] {
  return entries.map((entry) => ({
    ...entry,
    actorName: staffName(db, entry.actorId),
  }));
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
