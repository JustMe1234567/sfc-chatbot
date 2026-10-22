import type { Store } from "./types";
import type { MessageRole } from "./types";

export interface InboxItem {
  id: string;
  state: string;
  createdAt: string;
  messageCount: number;
  lastMessage: { role: MessageRole; text: string; createdAt: string } | null;
}

export function roleLabel(role: MessageRole): string {
  if (role === "visitor") return "Visitor";
  if (role === "bot") return "Bot";
  return "Staff";
}

/**
 * The shared inbox read model: unclaimed escalations with enough preview for
 * a staff member to pick a conversation. Used by both the staff API and the
 * dashboard page so the two can never drift.
 */
export async function summarizeSharedInbox(store: Store): Promise<InboxItem[]> {
  const escalated = await store.listConversationsByState("awaiting_staff");
  return Promise.all(
    escalated.map(async (conversation) => {
      const messages = await store.listMessages(conversation.id);
      const last = messages.at(-1);
      return {
        id: conversation.id,
        state: conversation.state,
        createdAt: conversation.createdAt,
        messageCount: messages.length,
        lastMessage: last
          ? { role: last.role, text: last.text, createdAt: last.createdAt }
          : null,
      };
    }),
  );
}
