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
  /** The visitor's full name from the contact form (ticket 66); null on
   *  conversations from before the gate, which read as "Visitor". */
  visitorName: string | null;
  /** Whether the conversation still sits in Incoming or Active. */
  active: boolean;
  /** The in-dashboard alert: something new for staff to read. */
  attention: boolean;
  /** When the current attention episode began, or null once viewed (ticket
   *  44): the stable identity of the "something new" event, since attention
   *  never re-stamps while standing. */
  attentionAt: string | null;
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
    visitorName: conversation.visitorName,
    active: isConversationActive(conversation),
    attention: conversation.attentionAt !== null,
    attentionAt: conversation.attentionAt,
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

/** What a conversation from before the contact gate is called (ticket 66). */
export const VISITOR_FALLBACK_NAME = "Visitor";

/**
 * The staff lists' primary label (ticket 66): the visitor's full name beside
 * the existing state — "Jane Doe · claimed" — shared by the Conversations
 * and History rows and the selected pane. Older conversations without a
 * name stay readable as "Visitor · bot".
 */
export function deskLabel(item: { visitorName: string | null; state: string }): string {
  return `${item.visitorName ?? VISITOR_FALLBACK_NAME} · ${DESK_STATE_LABELS[item.state] ?? item.state}`;
}

/**
 * The three-tier status every live desk surface shares (ticket 44): the
 * strongest tier wins, and each tier always pairs its color with visible
 * text or an icon carrying an accessible name.
 */
export type DeskStatus = "needs_human" | "attention" | "active";

export const DESK_STATUS_LABELS: Record<DeskStatus, string> = {
  needs_human: "Needs human",
  attention: "New message",
  active: "Active",
};

export function deskStatus(item: { state: string; attention: boolean }): DeskStatus {
  if (item.state === "awaiting_staff") return "needs_human";
  if (item.attention) return "attention";
  return "active";
}

/** One "something new for staff" occurrence, as heard by the notification
 *  sound (ticket 44). The id anchors the attention episode's start instant,
 *  so polling, navigation, and a second view all read the same identity and
 *  sound at most once per staff browser. */
export interface AttentionEvent {
  conversationId: string;
  id: string;
}

export function deskAttentionEvents(items: DeskItem[]): AttentionEvent[] {
  return items
    .filter((item) => item.attentionAt !== null)
    .map((item) => ({
      conversationId: item.id,
      id: `${item.id}:${item.attentionAt}`,
    }));
}
