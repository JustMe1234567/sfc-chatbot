import { beforeAll, afterEach, describe, expect, it } from "vitest";
import {
  ask,
  loadHistory,
  loadHistoryAs,
  startConversation,
  TEST_ORIGIN,
  testPostgresUrl,
  useTempDatabase,
  warmChatbotService,
  type ConversationStart,
  countQuery,
} from "./helpers";
import {
  CookieJar,
  enrollTotp,
  provisionStaff,
  signInWithTotp,
} from "./auth-helpers";

const STAFF_EMAIL = "alice@example.edu";
const STAFF_PASSWORD = "alice-return-harbor-61";

const PRESENT_WINDOW_MS = String(10 * 60_000);
const DEPARTED_WINDOW_MS = "1";
const LONG_TTL_MS = String(24 * 60 * 60 * 1000);
const SHORT_TTL_MS = "1";

let staffTotp: Awaited<ReturnType<typeof enrollTotp>>;

interface OutboxMail {
  to_address: string;
  subject: string;
  body: string;
}

async function outbox(): Promise<OutboxMail[]> {
  const { getChatbotService } = await import("../src/db/service");
  const { db } = await getChatbotService();
  return db.all<OutboxMail>(
    countQuery(
      "SELECT to_address, subject, body FROM mail_outbox ORDER BY seq",
      "SELECT to_address, subject, body FROM mail_outbox ORDER BY rowid",
    ),
  );
}

async function postEmail(conversation: ConversationStart, email: string): Promise<Response> {
  const { POST } = await import("../src/app/api/v1/conversations/[id]/email/route");
  return POST(
    new Request(`${TEST_ORIGIN}/api/v1/conversations/${conversation.id}/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${conversation.token}`,
      },
      body: JSON.stringify({ email }),
    }),
    { params: Promise.resolve({ id: conversation.id }) },
  );
}

async function redeem(rawToken: string): Promise<Response> {
  const { POST } = await import("../src/app/api/v1/return/route");
  return POST(
    new Request(`${TEST_ORIGIN}/api/v1/return`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: rawToken }),
    }),
  );
}

async function staffClaimReply(
  conversationId: string,
  replyText: string,
): Promise<{ claim: Response; reply: Response }> {
  const jar = new CookieJar();
  await signInWithTotp(jar, STAFF_EMAIL, STAFF_PASSWORD, staffTotp);
  const claimRoute = await import("../src/app/api/staff/conversations/[id]/claim/route");
  const claim = await claimRoute.POST(
    new Request(`${TEST_ORIGIN}/api/staff/conversations/${conversationId}/claim`, {
      method: "POST",
      headers: { cookie: jar.header(), origin: TEST_ORIGIN },
    }),
    { params: Promise.resolve({ id: conversationId }) },
  );
  const replyRoute = await import("../src/app/api/staff/conversations/[id]/reply/route");
  const reply = await replyRoute.POST(
    new Request(`${TEST_ORIGIN}/api/staff/conversations/${conversationId}/reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: jar.header(),
        origin: TEST_ORIGIN,
      },
      body: JSON.stringify({ text: replyText }),
    }),
    { params: Promise.resolve({ id: conversationId }) },
  );
  return { claim, reply };
}

/** Escalate, then optionally leave an email: the ticket 07 setup. */
async function escalatedConversation(email?: string): Promise<ConversationStart> {
  const conversation = await startConversation();
  await ask(conversation, "Something no rule covers; I need to speak to a human.");
  if (email !== undefined) {
    const response = await postEmail(conversation, email);
    expect(response.status).toBe(200);
  }
  return conversation;
}

function extractToken(body: string): string {
  const match = body.match(/return\?token=([A-Za-z0-9_-]+)/);
  if (!match?.[1]) {
    throw new Error(`no return token in mail body: ${body}`);
  }
  return match[1];
}

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await warmChatbotService();
  await provisionStaff({ email: STAFF_EMAIL, password: STAFF_PASSWORD, name: "Alice" });
  staffTotp = await enrollTotp(new CookieJar(), STAFF_EMAIL, STAFF_PASSWORD);
});

afterEach(() => {
  process.env.VISITOR_PRESENCE_WINDOW_MS = PRESENT_WINDOW_MS;
  process.env.RETURN_LINK_TTL_MS = LONG_TTL_MS;
});

describe("an optional email is collected only after escalation", () => {
  it("refuses an email before handoff and validates the address", async () => {
    process.env.VISITOR_PRESENCE_WINDOW_MS = PRESENT_WINDOW_MS;
    const conversation = await startConversation();

    const tooEarly = await postEmail(conversation, "visitor@example.org");
    expect(tooEarly.status).toBe(409);

    await ask(conversation, "Please tell me about the canteen menu on Fridays; I need to speak to a human.");
    const invalid = await postEmail(conversation, "not-an-email");
    expect(invalid.status).toBe(400);

    const accepted = await postEmail(conversation, "  visitor@example.org ");
    expect(accepted.status).toBe(200);
    const body = (await accepted.json()) as { email: string };
    expect(body.email).toBe("visitor@example.org");

    // Another visitor's credential cannot attach an email.
    const outsider = await startConversation();
    const { POST } = await import("../src/app/api/v1/conversations/[id]/email/route");
    const hijack = await POST(
      new Request(`${TEST_ORIGIN}/api/v1/conversations/${conversation.id}/email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${outsider.token}`,
        },
        body: JSON.stringify({ email: "evil@example.org" }),
      }),
      { params: Promise.resolve({ id: conversation.id }) },
    );
    expect(hijack.status).toBe(404);
  });
});

describe("a staff reply to a present visitor never emails", () => {
  it("delivers the reply in the widget only", async () => {
    process.env.VISITOR_PRESENCE_WINDOW_MS = PRESENT_WINDOW_MS;
    const conversation = await escalatedConversation("present@example.org");
    // The visitor reads history right before staff reply: they are on the page.
    await loadHistory(conversation);

    const { reply } = await staffClaimReply(conversation.id, "Alice here, still with you?");
    expect(reply.status).toBe(200);
    expect((await outbox()).filter((mail) => mail.to_address === "present@example.org")).toHaveLength(0);

    const history = await loadHistory(conversation);
    const body = (await history.json()) as { messages: { role: string }[] };
    expect(body.messages.at(-1)?.role).toBe("staff");
  });

  it("never emails when no address was provided", async () => {
    process.env.VISITOR_PRESENCE_WINDOW_MS = DEPARTED_WINDOW_MS;
    const conversation = await escalatedConversation();
    await loadHistory(conversation);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const { reply } = await staffClaimReply(conversation.id, "Anyone still there?");
    expect(reply.status).toBe(200);
    expect(await outbox()).toHaveLength(0);
  });
});

describe("a staff reply after departure sends one return link", () => {
  it("emails a short-lived link without the transcript, exactly once", async () => {
    process.env.VISITOR_PRESENCE_WINDOW_MS = DEPARTED_WINDOW_MS;
    process.env.RETURN_LINK_TTL_MS = LONG_TTL_MS;
    const conversation = await escalatedConversation("gone@example.org");
    await loadHistory(conversation);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const { reply } = await staffClaimReply(conversation.id, "The deadline is next Friday, bring your transcript.");
    expect(reply.status).toBe(200);

    const mail = (await outbox()).filter((entry) => entry.to_address === "gone@example.org");
    expect(mail).toHaveLength(1);
    expect(mail[0]!.body).toContain("/return?token=");
    // The email carries no transcript: the reply text itself must not leak.
    expect(mail[0]!.body).not.toContain("deadline is next Friday");
    expect(mail[0]!.body).not.toContain("transcript");

    // A second reply after another departure does not email again.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await staffClaimReply(conversation.id, "Also bring a photo ID.");
    expect(second.reply.status).toBe(200);
    expect((await outbox()).filter((entry) => entry.to_address === "gone@example.org")).toHaveLength(1);
  });

  it("sends the return link only once the visitor actually departs", async () => {
    // Present at the first reply, gone by the second.
    process.env.VISITOR_PRESENCE_WINDOW_MS = PRESENT_WINDOW_MS;
    const conversation = await escalatedConversation("late@example.org");
    await loadHistory(conversation);
    await staffClaimReply(conversation.id, "Are you still there?");

    process.env.VISITOR_PRESENCE_WINDOW_MS = DEPARTED_WINDOW_MS;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const jar = new CookieJar();
    await signInWithTotp(jar, STAFF_EMAIL, STAFF_PASSWORD, staffTotp);
    const replyRoute = await import("../src/app/api/staff/conversations/[id]/reply/route");
    const reply = await replyRoute.POST(
      new Request(`${TEST_ORIGIN}/api/staff/conversations/${conversation.id}/reply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: jar.header(),
          origin: TEST_ORIGIN,
        },
        body: JSON.stringify({ text: "Signing off; here is your way back." }),
      }),
      { params: Promise.resolve({ id: conversation.id }) },
    );
    expect(reply.status).toBe(200);
    expect((await outbox()).filter((entry) => entry.to_address === "late@example.org")).toHaveLength(1);
  });
});

describe("redeeming a return link", () => {
  async function departedConversationWithEmail(
    email: string,
    ttlMs: string = LONG_TTL_MS,
  ): Promise<ConversationStart> {
    process.env.VISITOR_PRESENCE_WINDOW_MS = DEPARTED_WINDOW_MS;
    process.env.RETURN_LINK_TTL_MS = ttlMs;
    const conversation = await escalatedConversation(email);
    await loadHistory(conversation);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const { reply } = await staffClaimReply(conversation.id, "Here is your answer about courses.");
    expect(reply.status).toBe(200);
    return conversation;
  }

  it("restores exactly its own conversation and history", async () => {
    const conversation = await departedConversationWithEmail("back@example.org");
    const mail = (await outbox()).find((entry) => entry.to_address === "back@example.org")!;
    const rawToken = extractToken(mail.body);

    const redemption = await redeem(rawToken);
    expect(redemption.status).toBe(200);
    const session = (await redemption.json()) as { id: string; token: string; expiresAt: string };
    expect(session.id).toBe(conversation.id);

    const history = await loadHistory({ id: conversation.id, token: session.token });
    expect(history.status).toBe(200);
    const body = (await history.json()) as { messages: { role: string; text: string }[] };
    expect(body.messages.at(-1)?.text).toContain("Here is your answer about courses.");

    // The restored credential reads only its own conversation.
    const other = await escalatedConversation();
    const crossing = await loadHistoryAs(
      { id: conversation.id, token: session.token },
      other,
    );
    expect(crossing.status).toBe(404);
  });

  it("rejects a used, expired, or unknown link", async () => {
    const conversation = await departedConversationWithEmail("once@example.org");
    const mail = (await outbox()).find((entry) => entry.to_address === "once@example.org")!;
    const rawToken = extractToken(mail.body);

    const first = await redeem(rawToken);
    expect(first.status).toBe(200);
    const replay = await redeem(rawToken);
    expect(replay.status).toBe(410);

    const unknown = await redeem("totally-unknown-token-value");
    expect(unknown.status).toBe(410);

    // A short-lived link that has aged out is refused even unused.
    const expired = await departedConversationWithEmail("late2@example.org", SHORT_TTL_MS);
    const expiredMail = (await outbox()).find((entry) => entry.to_address === "late2@example.org")!;
    const expiredToken = extractToken(expiredMail.body);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const expiredRedemption = await redeem(expiredToken);
    expect(expiredRedemption.status).toBe(410);
  });

  it("rejects malformed redemption requests", async () => {
    const missing = await redeem(undefined as unknown as string);
    expect(missing.status).toBe(400);
    const wrongType = await redeem(42 as unknown as string);
    expect(wrongType.status).toBe(400);
  });

  it("throttles redemption hammering", async () => {
    let throttled = 0;
    for (let i = 0; i < 22; i++) {
      const response = await redeem("hammering-attempt-token");
      if (response.status === 429) {
        throttled += 1;
      } else {
        expect(response.status).toBe(410);
      }
    }
    expect(throttled).toBeGreaterThanOrEqual(1);
  });
});

describe("public abuse limits on the email endpoint", () => {
  it("throttles repeated saves and rejects oversized addresses", async () => {
    process.env.VISITOR_PRESENCE_WINDOW_MS = PRESENT_WINDOW_MS;
    const conversation = await escalatedConversation();

    const oversized = await postEmail(conversation, `${"a".repeat(250)}@example.org`);
    expect(oversized.status).toBe(400);

    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) {
      statuses.push((await postEmail(conversation, "burst@example.org")).status);
    }
    expect(statuses.filter((status) => status === 200)).toHaveLength(20);
    expect(statuses.filter((status) => status === 429)).toHaveLength(2);
  });
});
