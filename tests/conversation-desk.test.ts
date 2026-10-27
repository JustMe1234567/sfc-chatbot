import { beforeAll, describe, expect, it } from "vitest";
import { ask, loadHistory, startConversation, TEST_ORIGIN, useTempDatabase, warmChatbotService, type ConversationStart } from "./helpers";
import {
  CookieJar,
  enrollTotp,
  provisionStaff,
  signInWithTotp,
} from "./auth-helpers";

const STAFF_EMAIL = "desk@example.edu";
const STAFF_PASSWORD = "desk-attention-manor-6c";
const SECOND_STAFF_EMAIL = "colleague@example.edu";
const SECOND_STAFF_PASSWORD = "colleague-attention-pier-9f";

let staffTotp: Awaited<ReturnType<typeof enrollTotp>>;

interface DeskItem {
  id: string;
  state: string;
  attention: boolean;
  createdAt: string;
  lastActivityAt: string;
  messageCount: number;
  lastMessage: { role: string; text: string } | null;
}

interface DeskBody {
  incoming: DeskItem[];
  active: DeskItem[];
  attentionCount: number;
}

async function deskGet(jar: CookieJar, view?: "history"): Promise<Response> {
  const { GET } = await import("../src/app/api/staff/conversations/route");
  return GET(
    new Request(`${TEST_ORIGIN}/api/staff/conversations${view ? `?view=${view}` : ""}`, {
      headers: { cookie: jar.header() },
    }),
  );
}

async function deskBody(jar: CookieJar, view?: "history"): Promise<DeskBody & { conversations?: DeskItem[] }> {
  const response = await deskGet(jar, view);
  expect(response.status).toBe(200);
  return (await response.json()) as DeskBody & { conversations?: DeskItem[] };
}

async function staffAction(
  jar: CookieJar,
  conversationId: string,
  action: "claim" | "reply" | "close",
  body?: unknown,
): Promise<Response> {
  const route = await import(`../src/app/api/staff/conversations/[id]/${action}/route`);
  return route.POST(
    new Request(`${TEST_ORIGIN}/api/staff/conversations/${conversationId}/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: jar.header(),
        origin: TEST_ORIGIN,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    { params: Promise.resolve({ id: conversationId }) },
  );
}

async function staffDetail(jar: CookieJar, conversationId: string): Promise<Response> {
  const { GET } = await import("../src/app/api/staff/conversations/[id]/route");
  return GET(
    new Request(`${TEST_ORIGIN}/api/staff/conversations/${conversationId}`, {
      headers: { cookie: jar.header() },
    }),
    { params: Promise.resolve({ id: conversationId }) },
  );
}

async function sql<T>(query: string, ...params: (string | number)[]): Promise<T> {
  const { getChatbotService } = await import("../src/db/service");
  const { db } = await getChatbotService();
  return db.prepare(query).get(...params) as T;
}

async function setLastActivity(conversationId: string, iso: string): Promise<void> {
  await sql("UPDATE conversations SET last_activity_at = ? WHERE id = ?", iso, conversationId);
}

async function lastActivityOf(conversationId: string): Promise<string> {
  return (await sql<{ last_activity_at: string }>(
    "SELECT last_activity_at FROM conversations WHERE id = ?",
    conversationId,
  )).last_activity_at;
}

async function sessionExpiryOf(conversationId: string): Promise<string> {
  return (await sql<{ expires_at: string }>(
    "SELECT MAX(expires_at) AS expires_at FROM visitor_sessions WHERE conversation_id = ?",
    conversationId,
  )).expires_at;
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await warmChatbotService();
  await provisionStaff({ email: STAFF_EMAIL, password: STAFF_PASSWORD, name: "Dana" });
  await provisionStaff({ email: SECOND_STAFF_EMAIL, password: SECOND_STAFF_PASSWORD, name: "Riley" });
  staffTotp = await enrollTotp(new CookieJar(), STAFF_EMAIL, STAFF_PASSWORD);
});

async function staffJar(): Promise<CookieJar> {
  const jar = new CookieJar();
  await signInWithTotp(jar, STAFF_EMAIL, STAFF_PASSWORD, staffTotp);
  return jar;
}

/** Escalate so the conversation reaches awaiting_staff. */
async function escalatedConversation(text: string): Promise<ConversationStart> {
  const conversation = await startConversation();
  await ask(conversation, text);
  return conversation;
}

describe("the conversation desk lists active work", () => {
  it("shows incoming, bot-active, and claimed conversations with previews, newest activity first", async () => {
    const claimedChat = await escalatedConversation("Desk test: transfer my credits, nobody covers this.");
    // A seeded rule answers this one, so the conversation stays bot_active.
    const botChat = await startConversation();
    await ask(botChat, "How do I apply?");

    const jar = await staffJar();
    expect((await staffAction(jar, claimedChat.id, "claim")).status).toBe(200);

    // A fresh visitor message in the claimed chat makes it the newest activity.
    await ask(claimedChat, "Also, does the bus stop nearby?");

    const desk = await deskBody(jar);
    // Claiming did not remove the conversation from the list: it moved sections.
    expect(desk.incoming.map((item) => item.id)).not.toContain(claimedChat.id);
    expect(desk.active.map((item) => item.id)).toEqual([claimedChat.id, botChat.id]);

    const claimedItem = desk.active[0]!;
    expect(claimedItem.state).toBe("claimed");
    expect(claimedItem.lastMessage?.text).toContain("bus stop nearby");
    // Visitor question, handoff notice, follow-up question.
    expect(claimedItem.messageCount).toBe(3);

    const botItem = desk.active[1]!;
    expect(botItem.state).toBe("bot_active");
    expect(botItem.lastMessage?.role).toBe("bot");
  });

  it("keeps bot-active chats out of Incoming and waiting chats out of Active", async () => {
    const waiting = await escalatedConversation("Desk test: lost student card, nothing covers this.");
    const chatting = await startConversation();
    await ask(chatting, "Tell me about the tuition fees.");

    const desk = await deskBody(await staffJar());
    expect(desk.incoming.some((item) => item.id === waiting.id)).toBe(true);
    expect(desk.active.some((item) => item.id === waiting.id)).toBe(false);
    expect(desk.active.some((item) => item.id === chatting.id)).toBe(true);
    expect(desk.incoming.every((item) => item.state === "awaiting_staff")).toBe(true);
  });
});

describe("attention signals for new visitor messages", () => {
  it("marks a conversation needing attention once, and viewing or replying clears it", async () => {
    const conversation = await escalatedConversation("Desk test: parking permit question, nobody covers this.");

    let desk = await deskBody(await staffJar());
    const item = [...desk.incoming, ...desk.active].find((entry) => entry.id === conversation.id);
    expect(item?.attention).toBe(true);
    expect(desk.attentionCount).toBeGreaterThanOrEqual(1);

    // Polling the list again must not duplicate or inflate the alert.
    desk = await deskBody(await staffJar());
    expect(desk.attentionCount).toBeGreaterThanOrEqual(1);
    const again = [...desk.incoming, ...desk.active].find((entry) => entry.id === conversation.id);
    expect(again?.attention).toBe(true);

    // Viewing the transcript clears the attention state.
    expect((await staffDetail(await staffJar(), conversation.id)).status).toBe(200);
    desk = await deskBody(await staffJar());
    const viewed = [...desk.incoming, ...desk.active].find((entry) => entry.id === conversation.id);
    expect(viewed?.attention).toBe(false);
    const afterView = [...desk.incoming, ...desk.active].filter((entry) => entry.attention).length;
    expect(desk.attentionCount).toBe(afterView);

    // A new visitor message raises it again; a staff reply clears it.
    await ask(conversation, "Desk test: one more thing about the parking permit.");
    desk = await deskBody(await staffJar());
    expect([...desk.incoming, ...desk.active].find((entry) => entry.id === conversation.id)?.attention).toBe(true);

    expect((await staffAction(await staffJar(), conversation.id, "claim")).status).toBe(200);
    expect((await staffAction(await staffJar(), conversation.id, "reply", { text: "Dana here, checking." })).status).toBe(200);
    desk = await deskBody(await staffJar());
    expect([...desk.incoming, ...desk.active].find((entry) => entry.id === conversation.id)?.attention).toBe(false);
  });
});

describe("the exact 24-hour inactivity boundary", () => {
  it("keeps a conversation active up to the boundary and moves it to history past it", async () => {
    const { isConversationActive } = await import("../src/domain/activity");
    const base = {
      id: "boundary-check",
      state: "awaiting_staff" as const,
      createdAt: "2027-01-01T00:00:00.000Z",
      claimedBy: null,
      claimedAt: null,
      visitorEmail: null,
      visitorLastSeenAt: null,
      closedAt: null,
      replacedBy: null,
      attentionAt: null,
    };
    const now = new Date("2027-01-02T00:00:00.000Z");
    const boundary = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    // Exactly 24 hours of quiet: still active. One millisecond more: not.
    expect(isConversationActive({ ...base, lastActivityAt: boundary.toISOString() }, now)).toBe(true);
    expect(
      isConversationActive({ ...base, lastActivityAt: new Date(boundary.getTime() - 1).toISOString() }, now),
    ).toBe(false);
    // A new meaningful message before expiry resets the clock.
    expect(
      isConversationActive(
        { ...base, lastActivityAt: new Date(now.getTime() - 60_000).toISOString() },
        now,
      ),
    ).toBe(true);
    // A closed conversation is never active, however fresh its messages are.
    expect(
      isConversationActive({ ...base, state: "closed", lastActivityAt: base.createdAt }, now),
    ).toBe(false);
  });

  it("stops offering an inactive conversation for work and answers 409 to staff and visitor replies", async () => {
    const conversation = await escalatedConversation("Desk test: evening course brochure, nothing covers this.");
    const jar = await staffJar();

    // Just inside the window: normal work.
    await setLastActivity(conversation.id, hoursAgo(23));
    let desk = await deskBody(jar);
    expect(desk.incoming.some((item) => item.id === conversation.id)).toBe(true);
    expect((await staffAction(jar, conversation.id, "claim")).status).toBe(200);

    // A claimed conversation that goes quiet leaves the Active list too.
    await setLastActivity(conversation.id, hoursAgo(25));
    desk = await deskBody(jar);
    expect(desk.incoming.some((item) => item.id === conversation.id)).toBe(false);
    expect(desk.active.some((item) => item.id === conversation.id)).toBe(false);

    const history = (await deskBody(jar, "history")).conversations ?? [];
    const historyItem = history.find((item) => item.id === conversation.id);
    expect(historyItem).toBeDefined();
    expect(historyItem!.messageCount).toBeGreaterThanOrEqual(2);

    // Staff cannot reply to or claim an inactive conversation.
    const reply = await staffAction(jar, conversation.id, "reply", { text: "Anyone there?" });
    expect(reply.status).toBe(409);
    expect(((await reply.json()) as { error: { code: string } }).error.code).toBe("conversation_inactive");
    const reclaim = await staffAction(jar, conversation.id, "claim");
    expect(reclaim.status).toBe(409);

    // The visitor's valid credential can still read, but continuing starts
    // a new conversation: the API refuses with the same code the widget
    // already handles for closures.
    const history2 = await loadHistory(conversation);
    expect(history2.status).toBe(200);
    const visitorReply = await ask(conversation, "Desk test: is anyone still there?");
    expect(visitorReply.status).toBe(409);
    expect(((await visitorReply.json()) as { error: { code: string } }).error.code).toBe("conversation_inactive");

    // The transcript is kept, not deleted, by the move to history.
    expect((await sql<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?", conversation.id)).n).toBeGreaterThanOrEqual(2);
  });

  it("lets the visitor's next question start a fresh conversation after inactivity", async () => {
    const conversation = await escalatedConversation("Desk test: library basement request, nothing covers this.");
    await setLastActivity(conversation.id, hoursAgo(25));
    expect((await ask(conversation, "Desk test: is this thing still on?")).status).toBe(409);

    // The exact sequence the widget performs on that refusal: start a new
    // conversation and ask the carried-over question there. Whatever the
    // matcher decides for it, the visitor can continue.
    const fresh = await startConversation();
    expect(fresh.id).not.toBe(conversation.id);
    const retry = await ask(fresh, "Desk test: is this thing still on?");
    expect(retry.status).toBe(200);
  });

  it("does not extend activity for polling, presence, or page views — only for messages", async () => {
    const conversation = await escalatedConversation("Desk test: scholarship deadline, nothing covers this.");
    const before = await lastActivityOf(conversation.id);

    // Polling (authorized history reads) refreshes presence, never activity.
    await loadHistory(conversation);
    await loadHistory(conversation);
    expect(await lastActivityOf(conversation.id)).toBe(before);

    // A new meaningful message resets the clock.
    await ask(conversation, "Desk test: and the scholarship interview dates?");
    const after = await lastActivityOf(conversation.id);
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  it("extends the visitor credential with each meaningful message", async () => {
    const conversation = await escalatedConversation("Desk test: graduation gown sizes, nothing covers this.");
    const expiryAfterEscalation = await sessionExpiryOf(conversation.id);

    await ask(conversation, "Desk test: and the cap measurements?");
    const expiryAfterVisitorMessage = await sessionExpiryOf(conversation.id);
    expect(new Date(expiryAfterVisitorMessage).getTime()).toBeGreaterThan(
      new Date(expiryAfterEscalation).getTime(),
    );

    // A staff reply keeps the visitor's credential alive too, so they can
    // poll the answer.
    const jar = await staffJar();
    expect((await staffAction(jar, conversation.id, "claim")).status).toBe(200);
    expect((await staffAction(jar, conversation.id, "reply", { text: "Riley will post sizes shortly." })).status).toBe(200);
    const expiryAfterStaffReply = await sessionExpiryOf(conversation.id);
    expect(new Date(expiryAfterStaffReply).getTime()).toBeGreaterThan(
      new Date(expiryAfterVisitorMessage).getTime(),
    );
  });

  it("refuses an expired credential for history and new messages", async () => {
    const conversation = await escalatedConversation("Desk test: campus map request, nothing covers this.");
    await sql("UPDATE visitor_sessions SET expires_at = ? WHERE conversation_id = ?", hoursAgo(1), conversation.id);

    // 404, not 401: a presented credential that no longer works must not
    // confirm the conversation exists (the shared visitor failure shape).
    expect((await loadHistory(conversation)).status).toBe(404);
    expect((await ask(conversation, "Desk test: hello again about the map?")).status).toBe(404);
  });

  it("keeps closed conversations in history and out of the active lists", async () => {
    const conversation = await escalatedConversation("Desk test: cafeteria menu, nothing covers this.");
    const jar = await staffJar();
    expect((await staffAction(jar, conversation.id, "claim")).status).toBe(200);
    expect((await staffAction(jar, conversation.id, "close")).status).toBe(200);

    const desk = await deskBody(jar);
    expect(desk.incoming.some((item) => item.id === conversation.id)).toBe(false);
    expect(desk.active.some((item) => item.id === conversation.id)).toBe(false);
    const history = (await deskBody(jar, "history")).conversations ?? [];
    expect(history.some((item) => item.id === conversation.id && item.state === "closed")).toBe(true);
  });
});
