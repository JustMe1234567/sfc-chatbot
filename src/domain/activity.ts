import { envMs } from "./limits";
import { sessionExpiryFrom } from "./tokens";
import type { Conversation, Store } from "./types";

/**
 * How long a conversation stays on the active lists after its latest
 * meaningful (visitor or staff) message (ticket 12).
 */
export const CONVERSATION_INACTIVITY_MS = 24 * 60 * 60 * 1000;

export function conversationInactivityMs(): number {
  // CONVERSATION_INACTIVITY_MS lets tests shrink the window so the boundary
  // is deterministic regardless of machine speed. Production keeps 24 hours.
  return envMs("CONVERSATION_INACTIVITY_MS", CONVERSATION_INACTIVITY_MS);
}

/**
 * The instant the inactivity clock reads: the latest meaningful message, or
 * creation for a conversation that has none yet. Polling, presence touches,
 * and page views are not meaningful and never move this.
 */
export function conversationLastActivity(conversation: Conversation): string {
  return conversation.lastActivityAt || conversation.createdAt;
}

/**
 * Whether the conversation still belongs on the desk's active lists: any
 * state except closed, and activity inside the window. Computed at read
 * time so the boundary is exact and no background sweep is needed to move a
 * conversation to History.
 */
export function isConversationActive(conversation: Conversation, now: Date = new Date()): boolean {
  if (conversation.state === "closed") {
    return false;
  }
  // Strictly past the window, matching the retention boundary's reading: at
  // exactly 24 hours of quiet the conversation has one moment left.
  return now.getTime() - new Date(conversationLastActivity(conversation)).getTime() <= conversationInactivityMs();
}

/**
 * A visitor message is meaningful (ticket 12): the inactivity clock and the
 * visitor's credentials slide forward together, and the staff desk is
 * alerted once (not per message) that something new awaits.
 */
export async function recordVisitorActivity(
  store: Store,
  conversationId: string,
  at: Date,
): Promise<void> {
  await store.touchConversationActivity(conversationId, at.toISOString(), sessionExpiryFrom(at));
  await store.setConversationAttention(conversationId, at.toISOString());
}
