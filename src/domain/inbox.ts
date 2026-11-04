import type { Store } from "./types";
import type { MessageRole } from "./types";
import { isConversationActive } from "./activity";

export function roleLabel(role: MessageRole): string {
  if (role === "visitor") return "Visitor";
  if (role === "bot") return "Bot";
  return "Staff";
}

/** One left-side list entry on the conversation desk (ticket 12). */
export interface DeskItem {
  id: string;
  state: string;
  /** Whether the conversation still sits in Incoming or Active. */
  active: boolean;
  /** The in-dashboard alert: something new for staff to read. */
  attention: boolean;
  createdAt: string;
  lastActivityAt: string;
  messageCount: number;
  lastMessage: { role: MessageRole; text: string; createdAt: string } | null;
}

async function toDeskItem(
  store: Store,
  conversation: Awaited<ReturnType<Store["listConversations"]>>[number],
): Promise<DeskItem> {
  const messages = await store.listMessages(conversation.id);
  const last = messages.at(-1);
  return {
    id: conversation.id,
    state: conversation.state,
    active: isConversationActive(conversation),
    attention: conversation.attentionAt !== null,
    createdAt: conversation.createdAt,
    lastActivityAt: conversation.lastActivityAt,
    messageCount: messages.length,
    lastMessage: last
      ? { role: last.role, text: last.text, createdAt: last.createdAt }
      : null,
  };
}

function byNewestActivity(a: DeskItem, b: DeskItem): number {
  return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
}

/**
 * The conversation desk read model (ticket 12): every active conversation —
 * Incoming holds the waiting escalations, Active holds bot-active and claimed
 * chats, since claiming never removes a conversation from the list — plus the
 * count of conversations needing attention. Newest activity first.
 */
export async function summarizeConversationDesk(
  store: Store,
): Promise<{ incoming: DeskItem[]; active: DeskItem[]; attentionCount: number }> {
  const conversations = await store.listConversations();
  const items = (await Promise.all(conversations.map((c) => toDeskItem(store, c)))).filter(
    (item) => item.active,
  );
  const incoming = items
    .filter((item) => item.state === "awaiting_staff")
    .sort(byNewestActivity);
  const active = items
    .filter((item) => item.state !== "awaiting_staff")
    .sort(byNewestActivity);
  const attentionCount = items.filter((item) => item.attention).length;
  return { incoming, active, attentionCount };
}

/**
 * History (ticket 12): everything that left the active lists — conversations
 * quiet for a day or closed — with their transcripts kept. Newest activity
 * first, so the most recently touched conversations surface first.
 */
export async function summarizeConversationHistory(store: Store): Promise<DeskItem[]> {
  const conversations = await store.listConversations();
  const items = await Promise.all(conversations.map((c) => toDeskItem(store, c)));
  return items.filter((item) => !item.active).sort(byNewestActivity);
}

/** The desk rows' short state names (ticket 12), shared by the server desk
 *  pane and the client row entries. */
export const DESK_STATE_LABELS: Record<string, string> = {
  bot_active: "bot",
  awaiting_staff: "waiting",
  claimed: "claimed",
  closed: "closed",
};
