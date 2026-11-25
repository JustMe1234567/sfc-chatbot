import { beforeAll, describe, expect, it } from "vitest";
import {
  ask,
  askRaw,
  countQuery,
  loadHistory,
  startConversation,
  TEST_ORIGIN,
  useTempDatabase,
  warmChatbotService,
  type ConversationStart,
} from "./helpers";
import {
  CookieJar,
  provisionStaff,
  staffApiRequest,
  signInAs,
} from "./auth-helpers";

/**
 * Ticket 69: confirm escalation and offer Chat, Email, or Phone contact.
 * The chat-start details stay temporary — a conversation is a saved contact
 * only once its visitor creates a contact request. A clicked Handoff Option
 * or typed Handoff phrase asks the persisted two-action confirmation; Yes
 * rides the existing waiting flow (one sound cue, Take over completes), No
 * offers Email and Phone, which leave the bot active with a masked
 * confirmation and the persistent red Contact Me until staff mark it
 * contacted. One open request per conversation, ever.
 */

const ADMIN_EMAIL = "requests-owner@example.edu";
const ADMIN_PASSWORD = "requests-owner-harbor-7f";
const STAFF_EMAIL = "requests-staff@example.edu";
const STAFF_PASSWORD = "requests-staff-quiet-3k";
const EDITOR_EMAIL = "requests-editor@example.edu";
const EDITOR_PASSWORD = "requests-editor-ridge-9v";

async function service(): Promise<Awaited<ReturnType<typeof import("../src/db/service").getChatbotService>>> {
  const { getChatbotService } = await import("../src/db/service");
  return getChatbotService();
}

async function count(
  postgresSql: string,
  sqliteSql: string,
  ...params: string[]
): Promise<number> {
  const { db } = await service();
  const row = (await db.get<{ n: number }>(countQuery(postgresSql, sqliteSql), ...params)) as {
    n: number;
  };
  return Number(row.n);
}

function escalationAlerts(conversationId: string): Promise<number> {
  return count(
    "SELECT COUNT(*)::int AS n FROM notifications WHERE type = 'escalation_alert' AND conversation_id = ?",
    "SELECT COUNT(*) AS n FROM notifications WHERE type = 'escalation_alert' AND conversation_id = ?",
    conversationId,
  );
}

function contactAlerts(conversationId: string): Promise<number> {
  return count(
    "SELECT COUNT(*)::int AS n FROM notifications WHERE type LIKE 'contact_request%' AND conversation_id = ?",
    "SELECT COUNT(*) AS n FROM notifications WHERE type LIKE 'contact_request%' AND conversation_id = ?",
    conversationId,
  );
}

async function errorCode(response: Response): Promise<string | undefined> {
  return ((await response.json()) as { error?: { code?: string } }).error?.code;
}

async function staffJar(
  email: string,
  password: string,
): Promise<CookieJar> {
  const jar = new CookieJar();
  await signInAs(jar, email, password);
  return jar;
}

async function staffPost(
  jar: CookieJar,
  conversationId: string,
  action: "claim" | "reply" | "mark-contacted",
  body?: unknown,
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
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    { params: Promise.resolve({ id: conversationId }) },
  );
}

/** A visitor's contact details as the gate stores them. */
const CONTACT = {
  fullName: "Jane Doe",
  email: "jane.doe@example.org",
  phone: "+1 (555) 010-0199",
};

interface ReplyBody {
  conversation: { state: string };
  reply: { text: string; choices?: { id: string; topic: string }[] } | null;
}

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await warmChatbotService();
  await provisionStaff({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: "Olive", role: "admin" });
  await provisionStaff({ email: STAFF_EMAIL, password: STAFF_PASSWORD, name: "Sam",  });
  await provisionStaff({ email: EDITOR_EMAIL, password: EDITOR_PASSWORD, name: "Eddie",  });
});

describe("temporary details are not saved contacts (ticket 69)", () => {
  it("keeps a fresh conversation out of the contacts list until a request exists", async () => {
    const conversation = await startConversation();
    const { store } = await service();

    // The details are on the conversation (labeling, transcript retention).
    const stored = await store.getConversation(conversation.id);
    expect(stored?.visitorEmail).toBe(CONTACT.email);
    expect(stored?.visitorName).toBe(CONTACT.fullName);
    // But no request, no saved contact row.
    expect(await store.getOpenContactRequest(conversation.id)).toBeNull();
    expect(await store.countConversationsWithContactRequest()).toBe(0);
    const page = await store.listConversationsWithContactRequest(1, 10);
    expect(page.map((row) => row.conversation.id)).not.toContain(conversation.id);
  });

  it("promotes the details exactly when a request is created", async () => {
    const conversation = await startConversation();
    await ask(conversation, "I want to talk to a person about the fees.");
    await askRaw(conversation, JSON.stringify({ choice: "handoff-yes" }));

    const { store } = await service();
    expect(await store.countConversationsWithContactRequest()).toBe(1);
    const page = await store.listConversationsWithContactRequest(1, 10);
    expect(page.map((row) => row.conversation.id)).toContain(conversation.id);
    expect(page[0]?.medium).toBe("chat");
  });
});

describe("No, contact me another way: email and phone (ticket 69)", () => {
  it("offers Email and Phone after No, and confirms the masked destination", async () => {
    const conversation = await startConversation();
    // The seeded typed handoff phrase asks the confirmation (ticket 69).
    await ask(conversation, "I want to talk to a person about the fees.");
    const no = await askRaw(conversation, JSON.stringify({ choice: "handoff-no" }));
    expect(no.status).toBe(200);
    const noBody = (await no.json()) as ReplyBody;
    expect(noBody.conversation.state).toBe("bot_active");
    expect(noBody.reply?.choices).toEqual([
      { id: "contact-email", topic: "Email" },
      { id: "contact-phone", topic: "Phone" },
    ]);

    const email = await askRaw(conversation, JSON.stringify({ choice: "contact-email" }));
    expect(email.status).toBe(200);
    const emailBody = (await email.json()) as ReplyBody;
    // The bot stays active; the confirmation masks the saved destination.
    expect(emailBody.conversation.state).toBe("bot_active");
    expect(emailBody.reply?.text).toContain("email you at j");
    expect(emailBody.reply?.text).toContain("@example.org");
    expect(emailBody.reply?.text).not.toContain(CONTACT.email);
    expect(emailBody.reply?.text).not.toContain("jane.doe");
    expect(emailBody.reply?.text).toContain("follow up");

    // One open request, one alert row, one email; the desk shows Contact Me.
    const { store } = await service();
    const request = await store.getOpenContactRequest(conversation.id);
    expect(request?.medium).toBe("email");
    // The email/phone request alerts under its own type; the escalation
    // alert belongs to the chat path, which this flow never entered.
    expect(await contactAlerts(conversation.id)).toBe(0);
    expect(await escalationAlerts(conversation.id)).toBe(0);

    const owner = await staffJar(ADMIN_EMAIL, ADMIN_PASSWORD);
    const deskResponse = await staffApiRequest(owner, "/api/staff/conversations");
    const desk = (await deskResponse.json()) as {
      active: { id: string; contactRequest: { medium: string } | null }[];
    };
    const item = desk.active.find((entry) => entry.id === conversation.id);
    expect(item?.contactRequest?.medium).toBe("email");
  });

  it("creates a phone request the same way, masking to the last four digits", async () => {
    const conversation = await startConversation();
    await ask(conversation, "I want to talk to a person about the fees.");
    await askRaw(conversation, JSON.stringify({ choice: "handoff-no" }));
    const phone = await askRaw(conversation, JSON.stringify({ choice: "contact-phone" }));
    expect(phone.status).toBe(200);
    const body = (await phone.json()) as ReplyBody;
    expect(body.conversation.state).toBe("bot_active");
    expect(body.reply?.text).toContain("call you at");
    expect(body.reply?.text).toContain("0199");
    expect(body.reply?.text).not.toContain(CONTACT.phone);
    expect(body.reply?.text).not.toContain("555) 010");

    const { store } = await service();
    expect((await store.getOpenContactRequest(conversation.id))?.medium).toBe("phone");
  });

  it("keeps bot answers flowing after an email request", async () => {
    const conversation = await startConversation();
    await ask(conversation, "I want to talk to a person about the fees.");
    await askRaw(conversation, JSON.stringify({ choice: "handoff-no" }));
    await askRaw(conversation, JSON.stringify({ choice: "contact-email" }));

    const followUp = await ask(conversation, "How do I apply?");
    expect(followUp.status).toBe(200);
    const body = (await followUp.json()) as ReplyBody;
    expect(body.conversation.state).toBe("bot_active");
    expect(body.reply?.text).toContain("admissions portal");
  });

  it("refuses a duplicate request while one is open, from any entry path", async () => {
    const conversation = await startConversation();
    await ask(conversation, "I want to talk to a person about the fees.");
    await askRaw(conversation, JSON.stringify({ choice: "handoff-no" }));
    expect((await askRaw(conversation, JSON.stringify({ choice: "contact-phone" }))).status).toBe(
      200,
    );

    // A direct retry of the same choice is stale-offered (the confirmation
    // replaced the prompt) and refused; the open request blocks new ones.
    const stale = await askRaw(conversation, JSON.stringify({ choice: "contact-email" }));
    expect(stale.status).toBe(400);
    expect(await errorCode(stale)).toBe("invalid_choice");

    // A new phrase prompt never appears while a request is open: the bot
    // answers truthfully instead.
    const again = await ask(conversation, "I want to talk to a person about something else.");
    expect(again.status).toBe(200);
    const body = (await again.json()) as ReplyBody;
    expect(body.reply?.text).toContain("already has your contact request");
    expect(body.reply?.choices).toBeUndefined();

    const { store } = await service();
    expect(await store.listContactRequests(conversation.id)).toHaveLength(1);
    expect(await contactAlerts(conversation.id)).toBe(0);
  });

  it("lets any dashboard role Mark contacted complete it, and allows a later request", async () => {
    const conversation = await startConversation();
    await ask(conversation, "I want to talk to a person about the fees.");
    await askRaw(conversation, JSON.stringify({ choice: "handoff-no" }));
    await askRaw(conversation, JSON.stringify({ choice: "contact-email" }));

    // Ticket 102 merged the editor into the advisor role, and Mark contacted
    // follows the desk's permission: every dashboard role completes it.
    const advisor = await staffJar(EDITOR_EMAIL, EDITOR_PASSWORD);
    const marked = await staffPost(advisor, conversation.id, "mark-contacted");
    expect(marked.status).toBe(200);
    const body = (await marked.json()) as {
      request: { status: string; completedBy: string | null; medium: string };
    };
    expect(body.request.status).toBe("completed");
    expect(body.request.medium).toBe("email");
    expect(body.request.completedBy).toBeTruthy();

    const staff = await staffJar(STAFF_EMAIL, STAFF_PASSWORD);

    const { store } = await service();
    expect(await store.getOpenContactRequest(conversation.id)).toBeNull();

    // Completion adds no chatbot message and does not close the chat: the
    // transcript still ends with the mask confirmation the request got.
    const history = await loadHistory(conversation);
    const historyBody = (await history.json()) as {
      conversation: { state: string };
      messages: { role: string; text: string }[];
    };
    expect(historyBody.conversation.state).toBe("bot_active");
    expect(historyBody.messages.at(-1)?.role).toBe("bot");
    expect(historyBody.messages.at(-1)?.text).toContain("email you at");

    // A later request is allowed, and the desk's Contact Me is gone.
    const deskBefore = await staffApiRequest(staff, "/api/staff/conversations");
    const deskDataBefore = (await deskBefore.json()) as {
      active: { id: string; contactRequest: unknown }[];
    };
    expect(
      deskDataBefore.active.find((entry) => entry.id === conversation.id)?.contactRequest,
    ).toBeNull();

    await ask(conversation, "I want to talk to a person about something else.");
    expect((await askRaw(conversation, JSON.stringify({ choice: "handoff-yes" }))).status).toBe(
      200,
    );
    expect((await store.getOpenContactRequest(conversation.id))?.medium).toBe("chat");
  });

  it("refuses Mark contacted with nothing open, and never completes another conversation's request", async () => {
    const jar = await staffJar(ADMIN_EMAIL, ADMIN_PASSWORD);
    const conversation = await startConversation();
    expect((await staffPost(jar, conversation.id, "mark-contacted")).status).toBe(409);

    // The open request of another conversation is unreachable: completion
    // is scoped to the URL's conversation.
    const target = await startConversation();
    await ask(target, "I want to talk to a person about this.");
    await askRaw(target, JSON.stringify({ choice: "handoff-no" }));
    await askRaw(target, JSON.stringify({ choice: "contact-phone" }));
    const other = await startConversation();
    const crossed = await staffPost(jar, other.id, "mark-contacted");
    expect(crossed.status).toBe(409);
    expect(await errorCode(crossed)).toBe("no_open_request");
    const { store } = await service();
    expect((await store.getOpenContactRequest(target.id))?.status).toBe("open");
  });

  it("creates sound attention without email delivery records", async () => {
    const conversation = await startConversation();
    await ask(conversation, "I want to talk to a person about the fees.");
    await askRaw(conversation, JSON.stringify({ choice: "handoff-no" }));
    await askRaw(conversation, JSON.stringify({ choice: "contact-phone" }));
    expect(await contactAlerts(conversation.id)).toBe(0);
    const { store } = await service();
    const desk = await store.getConversation(conversation.id);
    expect(desk?.attentionAt).not.toBeNull();
  });
});

describe("the unknown-question handoff (tickets 37/69)", () => {
  it("stays one click, creating the same Chat request and waiting state", async () => {
    const conversation = await startConversation();
    await ask(conversation, "What is the canteen menu on Thursdays?");
    const clicked = await askRaw(conversation, JSON.stringify({ choice: "request-human" }));
    expect(clicked.status).toBe(200);
    const body = (await clicked.json()) as ReplyBody;
    expect(body.conversation.state).toBe("awaiting_staff");

    // No second prompt was appended on this path.
    const { store } = await service();
    expect(await store.listContactRequests(conversation.id)).toHaveLength(1);
    expect((await store.getOpenContactRequest(conversation.id))?.medium).toBe("chat");
    expect(await escalationAlerts(conversation.id)).toBe(0);

    // Take over completes the Chat request.
    const jar = await staffJar(STAFF_EMAIL, STAFF_PASSWORD);
    expect((await staffPost(jar, conversation.id, "claim")).status).toBe(200);
    expect(await store.getOpenContactRequest(conversation.id)).toBeNull();
    expect((await store.listContactRequests(conversation.id))[0]?.status).toBe("completed");
  });

  it("hides the offer while a request is open", async () => {
    const conversation = await startConversation();
    await ask(conversation, "I want to talk to a person about this.");
    await askRaw(conversation, JSON.stringify({ choice: "handoff-no" }));
    await askRaw(conversation, JSON.stringify({ choice: "contact-email" }));

    const unknown = await ask(conversation, "What is the canteen menu on Thursdays?");
    const body = (await unknown.json()) as ReplyBody;
    expect(body.reply?.choices).toBeUndefined();
    expect(body.reply?.text).toContain("I don't have knowledge of that.");
  });
});

describe("stale and forged contact choices (ticket 69)", () => {
  it("rejects a contact choice that is no longer the last message", async () => {
    const conversation = await startConversation();
    await ask(conversation, "I want to talk to a person about this.");
    await askRaw(conversation, JSON.stringify({ choice: "handoff-no" }));
    // The medium prompt is last. Answer it, then replay the old No choice.
    await askRaw(conversation, JSON.stringify({ choice: "contact-email" }));
    const staleNo = await askRaw(conversation, JSON.stringify({ choice: "handoff-no" }));
    expect(staleNo.status).toBe(400);
    expect(await errorCode(staleNo)).toBe("invalid_choice");
    // Nothing was created by the stale click.
    const { store } = await service();
    expect(await store.listContactRequests(conversation.id)).toHaveLength(1);
  });

  it("cannot create an unavailable medium", async () => {
    const conversation = await startConversation();
    await ask(conversation, "I want to talk to a person about this.");
    await askRaw(conversation, JSON.stringify({ choice: "handoff-no" }));
    const fax = await askRaw(conversation, JSON.stringify({ choice: "contact-fax" }));
    expect(fax.status).toBe(400);
    expect(await errorCode(fax)).toBe("invalid_choice");
  });

  it("keeps the gate: a legacy conversation without details can do none of this", async () => {
    const { store } = await service();
    const { createSessionToken, hashSessionToken, sessionExpiry } = await import(
      "../src/domain/tokens"
    );
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await store.createConversation({
      id,
      state: "bot_active",
      createdAt: now,
      claimedBy: null,
      claimedAt: null,
      visitorName: null,
      visitorEmail: null,
      visitorPhone: null,
      visitorLastSeenAt: null,
      closedAt: null,
      replacedBy: null,
      lastActivityAt: now,
      attentionAt: null,
    });
    const token = createSessionToken();
    await store.createSession({
      tokenHash: hashSessionToken(token),
      conversationId: id,
      createdAt: now,
      expiresAt: sessionExpiry(),
    });
    const legacy: ConversationStart = { id, token };

    const prompt = await ask(legacy, "I want to speak to someone in admissions.");
    expect(prompt.status).toBe(409);
    expect(await errorCode(prompt)).toBe("contact_required");
    const click = await askRaw(legacy, JSON.stringify({ choice: "handoff-yes" }));
    expect(click.status).toBe(409);
    expect(await store.listContactRequests(id)).toEqual([]);
  });
});

describe("the request lifecycle follows the conversation's lifecycle (ticket 69)", () => {
  it("removes requests with the conversation under retention", async () => {
    const { store } = await service();
    const conversation = await startConversation();
    await ask(conversation, "I want to talk to a person about the fees.");
    await askRaw(conversation, JSON.stringify({ choice: "handoff-no" }));
    await askRaw(conversation, JSON.stringify({ choice: "contact-email" }));
    expect(await store.countConversationsWithContactRequest()).toBeGreaterThan(0);

    // Closing it makes the row History; the purge removes the conversation
    // with its requests (any quietBefore admits a closed conversation).
    await store.closeConversation(conversation.id);
    const { historyQuietBefore } = await import("../src/domain/activity");
    expect(
      await store.purgeHistoryConversation(conversation.id, new Date().toISOString()),
    ).toBe(true);
    const requests = await store.listContactRequests(conversation.id);
    expect(requests).toEqual([]);
    expect(await store.getOpenContactRequest(conversation.id)).toBeNull();
    const page = await store.listConversationsWithContactRequest(1, 50);
    expect(page.map((row) => row.conversation.id)).not.toContain(conversation.id);
  });

  it("does not carry requests into a Clear chat successor", async () => {
    const conversation = await startConversation();
    await ask(conversation, "I want to talk to a person about the fees.");
    await askRaw(conversation, JSON.stringify({ choice: "handoff-no" }));
    await askRaw(conversation, JSON.stringify({ choice: "contact-email" }));

    const { POST } = await import("../src/app/api/v1/conversations/[id]/clear/route");
    const cleared = await POST(
      new Request(`${TEST_ORIGIN}/api/v1/conversations/${conversation.id}/clear`, {
        method: "POST",
        headers: { Authorization: `Bearer ${conversation.token}` },
      }),
      { params: Promise.resolve({ id: conversation.id }) },
    );
    expect(cleared.status).toBe(200);
    const successor = (await cleared.json()) as { id: string };
    const { store } = await service();
    expect(await store.listContactRequests(successor.id)).toEqual([]);
    // The old conversation keeps its request history.
    expect(await store.listContactRequests(conversation.id)).toHaveLength(1);
  });
});
