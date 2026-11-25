import { beforeAll, describe, expect, it } from "vitest";
import {
  ask,
  askRaw,
  loadHistory,
  loadHistoryAs,
  startConversation,
  TEST_ORIGIN,
  useTempDatabase,
  warmChatbotService,
} from "./helpers";
import { CookieJar, provisionStaff, signInAs, staffApiRequest } from "./auth-helpers";

/**
 * Ticket 104: choosing Email or Phone ends the visitor's chat. The request
 * is created exactly as ticket 69 built it (one open request, promotion, one
 * alert), and then the visitor's session is revoked while the conversation
 * stays live server-side — not closed, no closing notice, no retention
 * start (decision 1). The masked confirmation is the transcript's last row
 * (decision 2 pins the bot's structural silence), the desk pins the
 * conversation in Active until an advisor marks it contacted (decision 3),
 * the Chat handoff path keeps its waiting → Take over semantics untouched,
 * and retention still removes the ended conversation in the usual way.
 */

const ADMIN_EMAIL = "end-chat-owner@example.edu";
const ADMIN_PASSWORD = "end-chat-owner-harbor-4d";

async function service(): Promise<Awaited<ReturnType<typeof import("../src/db/service").getChatbotService>>> {
  const { getChatbotService } = await import("../src/db/service");
  return getChatbotService();
}

async function errorCode(response: Response): Promise<string | undefined> {
  return ((await response.json()) as { error?: { code?: string } }).error?.code;
}

async function staffJar(email: string, password: string): Promise<CookieJar> {
  const jar = new CookieJar();
  await signInAs(jar, email, password);
  return jar;
}

async function staffPost(
  jar: CookieJar,
  conversationId: string,
  action: "claim" | "mark-contacted",
): Promise<Response> {
  const route = await import(
    `../src/app/api/staff/conversations/[id]/${action}/route`
  );
  return route.POST(
    new Request(`${TEST_ORIGIN}/api/staff/conversations/${conversationId}/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: jar.header(),
        origin: TEST_ORIGIN,
      },
    }),
    { params: Promise.resolve({ id: conversationId }) },
  );
}

async function staffDesk(
  jar: CookieJar,
  view?: "history",
): Promise<Response> {
  const route = await import("../src/app/api/staff/conversations/route");
  return route.GET(
    new Request(
      `${TEST_ORIGIN}/api/staff/conversations${view ? "?view=history" : ""}`,
      { headers: { cookie: jar.header(), origin: TEST_ORIGIN } },
    ),
  );
}

interface DeskBody {
  incoming: { id: string }[];
  active: { id: string; contactRequest: { medium: string } | null }[];
}

interface HistoryBody {
  conversations: { id: string }[];
}

interface ReplyBody {
  conversation: { state: string };
  reply: { text: string } | null;
  sessionEnded?: boolean;
}

/** The persisted two-step path to an Email or Phone request (ticket 69). */
async function requestMedium(
  conversation: Awaited<ReturnType<typeof startConversation>>,
  choice: "contact-email" | "contact-phone",
): Promise<Response> {
  await ask(conversation, "I want to talk to a person about the fees.");
  await askRaw(conversation, JSON.stringify({ choice: "handoff-no" }));
  return askRaw(conversation, JSON.stringify({ choice }));
}

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await warmChatbotService();
  await provisionStaff({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: "Olive", role: "admin" });
});

describe("the email/phone choice ends the visitor's session (ticket 104)", () => {
  it("the email path revokes the session, keeps the conversation live, and refuses further posts", async () => {
    const conversation = await startConversation();
    const email = await requestMedium(conversation, "contact-email");
    expect(email.status).toBe(200);
    const body = (await email.json()) as ReplyBody;
    // The widget's one-time ended view rides this flag; the confirmation is
    // the reply the visitor sees last.
    expect(body.sessionEnded).toBe(true);
    expect(body.conversation.state).toBe("bot_active");
    expect(body.reply?.text).toContain("email you at");

    const { store } = await service();
    // The conversation itself is NOT closed: same state, no closing notice.
    const stored = await store.getConversation(conversation.id);
    expect(stored?.state).toBe("bot_active");
    // One open email request, exactly as ticket 69 created it.
    const request = await store.getOpenContactRequest(conversation.id);
    expect(request?.medium).toBe("email");
    expect(request?.status).toBe("open");

    // The stored credential fails authorization with a stable error.
    const refused = await ask(conversation, "How do I apply?");
    expect(refused.status).toBe(404);
    expect(await errorCode(refused)).toBe("conversation_not_found");
    // The read side is just as dead: no replay of the transcript.
    expect((await loadHistory(conversation)).status).toBe(404);

    // Nothing was appended by the refused post: the confirmation is still
    // the last transcript row, of any role.
    const messages = await store.listMessages(conversation.id);
    expect(messages.at(-1)?.role).toBe("bot");
    expect(messages.at(-1)?.text).toContain("email you at");
  });

  it("the phone path ends the session the same way", async () => {
    const conversation = await startConversation();
    const phone = await requestMedium(conversation, "contact-phone");
    expect(phone.status).toBe(200);
    const body = (await phone.json()) as ReplyBody;
    expect(body.sessionEnded).toBe(true);
    expect(body.conversation.state).toBe("bot_active");
    expect(body.reply?.text).toContain("call you at");

    const { store } = await service();
    expect((await store.getOpenContactRequest(conversation.id))?.medium).toBe("phone");
    expect((await store.getConversation(conversation.id))?.state).toBe("bot_active");
    const refused = await ask(conversation, "Anyone there?");
    expect(refused.status).toBe(404);
    expect(await errorCode(refused)).toBe("conversation_not_found");
  });

  it("Start a new chat: a fresh gate submission starts a separate conversation", async () => {
    const conversation = await startConversation();
    await requestMedium(conversation, "contact-email");
    const { store } = await service();
    const before = await store.listMessages(conversation.id);

    // The ended view's action drops the dead credential; the gate's next
    // accepted submission creates a brand-new conversation.
    const fresh = await startConversation();
    expect(fresh.id).not.toBe(conversation.id);

    // Nothing carries over: empty transcript, no request, own session.
    expect(await store.listMessages(fresh.id)).toEqual([]);
    expect(await store.getOpenContactRequest(fresh.id)).toBeNull();

    // The old conversation stays intact for staff, request open.
    expect(await store.listMessages(conversation.id)).toEqual(before);
    expect((await store.getOpenContactRequest(conversation.id))?.status).toBe("open");

    // The dead credential cannot reach the new conversation either.
    expect((await loadHistoryAs(conversation, fresh)).status).toBe(404);
    // And the fresh chat works.
    expect((await ask(fresh, "How do I apply?")).status).toBe(200);
  });

  it("a quiet open-request conversation stays pinned in Active until Mark contacted", async () => {
    const conversation = await startConversation();
    await requestMedium(conversation, "contact-email");
    const owner = await staffJar(ADMIN_EMAIL, ADMIN_PASSWORD);

    // Go quiet past the 24-hour window.
    const quiet = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const { store } = await service();
    await store.touchConversationActivity(conversation.id, quiet, quiet);

    // Pinned: the Active list keeps it (with the Contact Me chip) and the
    // History list never gains it.
    const desk = (await (await staffDesk(owner)).json()) as DeskBody;
    const pinned = desk.active.find((item) => item.id === conversation.id);
    expect(pinned?.contactRequest?.medium).toBe("email");
    const history = (await (await staffDesk(owner, "history")).json()) as HistoryBody;
    expect(history.conversations.some((item) => item.id === conversation.id)).toBe(false);

    // Mark contacted completes the request per today's rules.
    expect((await staffPost(owner, conversation.id, "mark-contacted")).status).toBe(200);
    expect(await store.getOpenContactRequest(conversation.id)).toBeNull();

    // The ordinary 24-hour roll resumes only after completion.
    const deskAfter = (await (await staffDesk(owner)).json()) as DeskBody;
    expect(deskAfter.active.some((item) => item.id === conversation.id)).toBe(false);
    const historyAfter = (await (await staffDesk(owner, "history")).json()) as HistoryBody;
    expect(historyAfter.conversations.some((item) => item.id === conversation.id)).toBe(true);
  });

  it("burns the conversation's unused return links with the session", async () => {
    const conversation = await startConversation();
    const { createSessionToken, hashSessionToken, sessionExpiry } = await import(
      "../src/domain/tokens"
    );
    const { store } = await service();
    const link = createSessionToken();
    await store.createReturnToken({
      tokenHash: hashSessionToken(link),
      conversationId: conversation.id,
      createdAt: new Date().toISOString(),
      expiresAt: sessionExpiry(),
    });

    await requestMedium(conversation, "contact-email");

    // A burned link cannot mint a fresh credential into the ended chat:
    // redemption misses, so no path resumes the conversation's posts.
    expect(
      await store.redeemReturnToken(hashSessionToken(link), {
        tokenHash: hashSessionToken(createSessionToken()),
        createdAt: new Date().toISOString(),
        expiresAt: sessionExpiry(),
      }),
    ).toBeNull();
  });

  it("the Chat handoff path is unchanged: the session stays alive through waiting and Take over", async () => {
    const conversation = await startConversation();
    await ask(conversation, "I want to talk to a person about the fees.");
    const yes = await askRaw(conversation, JSON.stringify({ choice: "handoff-yes" }));
    expect(yes.status).toBe(200);
    const body = (await yes.json()) as ReplyBody;
    // No ended flag, no revocation: waiting → Take over semantics (ticket 103).
    expect(body.sessionEnded).toBeUndefined();
    expect(body.conversation.state).toBe("awaiting_staff");

    // The visitor can still post while waiting (the composer stays open).
    expect((await ask(conversation, "hello?")).status).toBe(200);
    expect((await loadHistory(conversation)).status).toBe(200);

    // The one-click path behaves the same.
    const clicked = await startConversation();
    await ask(clicked, "What is the canteen menu on Thursdays?");
    const oneClick = await askRaw(clicked, JSON.stringify({ choice: "request-human" }));
    expect(oneClick.status).toBe(200);
    expect(((await oneClick.json()) as ReplyBody).sessionEnded).toBeUndefined();

    // Take over completes the Chat request as today.
    const owner = await staffJar(ADMIN_EMAIL, ADMIN_PASSWORD);
    expect((await staffPost(owner, conversation.id, "claim")).status).toBe(200);
    const { store } = await service();
    expect(await store.getOpenContactRequest(conversation.id)).toBeNull();
  });

  it("retention still purges a quiet ended conversation with transcript and request", async () => {
    const conversation = await startConversation();
    await requestMedium(conversation, "contact-email");
    const { store } = await service();

    // Quiet past the window: the pin is a desk-display rule only — it does
    // not protect the conversation from the retention sweep.
    const quiet = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await store.touchConversationActivity(conversation.id, quiet, quiet);
    expect(
      await store.purgeHistoryConversation(conversation.id, new Date().toISOString()),
    ).toBe(true);

    // Conversation, transcript, request rows: all gone with the purge.
    expect(await store.getConversation(conversation.id)).toBeNull();
    expect(await store.listMessages(conversation.id)).toEqual([]);
    expect(await store.listContactRequests(conversation.id)).toEqual([]);
  });
});
