import type { ConversationState, Store } from "./types";
import type { MessageRole } from "./types";
import { isConversationActive } from "./activity";

export function roleLabel(role: MessageRole): string {
  if (role === "visitor") return "Visitor";
  if (role === "bot") return "Bot";
  return "Staff";
}

/**
 * The conversation's open email-or-phone contact request (ticket 69): the
 * persistent red Contact Me status. Chat requests are absent by design —
 * they ARE the waiting-for-staff state and read as Needs human.
 */
export interface OpenContactRequestView {
  id: string;
  medium: "email" | "phone";
}

/** One left-side list entry on the conversation desk (ticket 12). */
export interface DeskItem {
  id: string;
  /** The full conversation union (ticket 34): raw `string` forced the chip
   *  and label maps to key off untyped strings. */
  state: ConversationState;
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
  /** The conversation's open email/phone contact request, if any (ticket
   *  69): persistent until staff mark it contacted. */
  contactRequest: OpenContactRequestView | null;
  createdAt: string;
  lastActivityAt: string;
  messageCount: number;
  lastMessage: { role: MessageRole; text: string; createdAt: string } | null;
}

async function toDeskItem(
  store: Store,
  conversation: Awaited<ReturnType<Store["listConversations"]>>[number],
  openRequests: Map<string, OpenContactRequestView>,
): Promise<DeskItem> {
  return (await toDeskItemWithMessages(store, conversation, openRequests)).item;
}

/**
 * The desk item plus whether the visitor has said anything yet (ticket 73):
 * conversations without a visitor-authored message — a clear-created fresh
 * successor, or a contact-form-only session — are omitted from the staff's
 * live lists until the first visitor message lands, so blank rows never
 * crowd the desk. The flag stays out of the public DeskItem shape; the
 * API response simply omits those rows.
 */
async function toDeskItemWithMessages(
  store: Store,
  conversation: Awaited<ReturnType<Store["listConversations"]>>[number],
  openRequests: Map<string, OpenContactRequestView>,
): Promise<{ item: DeskItem; visitorAuthored: boolean }> {
  const messages = await store.listMessages(conversation.id);
  const last = messages.at(-1);
  const item: DeskItem = {
    id: conversation.id,
    state: conversation.state,
    visitorName: conversation.visitorName,
    // Pinned in Active (ticket 104, decision 3): a conversation with an open
    // email/phone request never leaves the active lists, however quiet —
    // the Contact Me chip and Mark contacted stay reachable until an advisor
    // completes the request, and the ordinary 24-hour roll resumes after
    // completion. Both list summaries read this flag, so the same exception
    // keeps the pinned conversation out of History too. Retention is not
    // deferred: isConversationActive (the visitor refusal and the purge
    // boundary) is untouched.
    active: isConversationActive(conversation) || openRequests.has(conversation.id),
    attention: conversation.attentionAt !== null,
    attentionAt: conversation.attentionAt,
    contactRequest: openRequests.get(conversation.id) ?? null,
    createdAt: conversation.createdAt,
    lastActivityAt: conversation.lastActivityAt,
    messageCount: messages.length,
    lastMessage: last
      ? { role: last.role, text: last.text, createdAt: last.createdAt }
      : null,
  };
  return { item, visitorAuthored: messages.some((m) => m.role === "visitor") };
}

function byNewestActivity(a: DeskItem, b: DeskItem): number {
  return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
}

/** The open email/phone requests as a per-conversation view map (ticket 69). */
async function openRequestViews(
  store: Store,
): Promise<Map<string, OpenContactRequestView>> {
  const requests = await store.listOpenContactRequests();
  return new Map(
    requests
      .filter((request) => request.medium !== "chat")
      .map((request) => [
        request.conversationId,
        { id: request.id, medium: request.medium as "email" | "phone" },
      ]),
  );
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
  const openRequests = await openRequestViews(store);
  const items = (
    await Promise.all(
      conversations.map((c) => toDeskItemWithMessages(store, c, openRequests)),
    )
  )
    // The live lists show only conversations the visitor has actually said
    // something in (ticket 73): clear-created fresh successors and
    // contact-form-only sessions stay invisible until their first visitor
    // message, then appear through the ordinary poll.
    .filter((entry) => entry.visitorAuthored)
    .map((entry) => entry.item)
    .filter((item) => item.active);
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
  const openRequests = await openRequestViews(store);
  const items = await Promise.all(
    conversations.map((c) => toDeskItem(store, c, openRequests)),
  );
  return items.filter((item) => !item.active).sort(byNewestActivity);
}

/** The desk rows' short state names (ticket 12), shared by the server desk
 *  pane and the client row entries. Keyed by the full union (ticket 34), so
 *  a new state fails to compile until it is named here. */
export const DESK_STATE_LABELS: Record<ConversationState, string> = {
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
export function deskLabel(item: {
  visitorName: string | null;
  state: ConversationState;
}): string {
  return `${item.visitorName ?? VISITOR_FALLBACK_NAME} · ${DESK_STATE_LABELS[item.state]}`;
}

/**
 * The desk's status tiers (tickets 44/69): the strongest tier wins, and
 * each tier always pairs its color with visible text or an icon carrying an
 * accessible name. "contact" is the persistent red Contact Me — an open
 * email/phone request — which, unlike the transient attention tier, never
 * clears on viewing.
 */
export type DeskStatus = "needs_human" | "attention" | "contact" | "active";

export const DESK_STATUS_LABELS: Record<DeskStatus, string> = {
  needs_human: "Needs human",
  attention: "New message",
  contact: "Contact Me",
  active: "Active",
};

export function deskStatus(item: {
  state: string;
  attention: boolean;
  contactRequest?: OpenContactRequestView | null;
}): DeskStatus {
  if (item.state === "awaiting_staff") return "needs_human";
  if (item.attention) return "attention";
  if (item.contactRequest) return "contact";
  return "active";
}

/** One "something new for staff" occurrence, as heard by the notification
 *  sound (ticket 44). The id anchors the attention episode's start instant,
 *  so polling, navigation, and a second view all read the same identity and
 *  sound at most once per staff browser. Ticket 69 adds one event per open
 *  email/phone contact request — a new request cues once, and the two
 *  sources cue independently. */
export interface AttentionEvent {
  conversationId: string;
  id: string;
}

export function deskAttentionEvents(items: DeskItem[]): AttentionEvent[] {
  const events: AttentionEvent[] = [];
  for (const item of items) {
    if (item.attentionAt !== null) {
      events.push({ conversationId: item.id, id: `${item.id}:${item.attentionAt}` });
    }
    if (item.contactRequest) {
      events.push({
        conversationId: item.id,
        id: `${item.id}:contact-request:${item.contactRequest.id}`,
      });
    }
  }
  return events;
}
