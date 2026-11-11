import { beforeAll, describe, expect, it } from "vitest";
import { ask, confirmHandoffYes, loadHistory, startConversation, TEST_ORIGIN,
  warmChatbotService,
} from "./helpers";
import {
  authRequest,
  CookieJar,
  enrollTotp,
  provisionStaff,
  signInWithTotp,
  useTempDatabase,
} from "./auth-helpers";

const ALICE_EMAIL = "alice@example.edu";
const ALICE_PASSWORD = "alice-enrol-superb-1";
const BOB_EMAIL = "bob@example.edu";
const BOB_PASSWORD = "bob-harbor-quietly-2";

let aliceTotp: Awaited<ReturnType<typeof enrollTotp>>;
let bobTotp: Awaited<ReturnType<typeof enrollTotp>>;

async function staffPost(
  jar: CookieJar,
  conversationId: string,
  action: "claim" | "reply" | "close",
  body?: unknown,
): Promise<Response> {
  const route = await import(
    `../src/app/api/staff/conversations/[id]/${action}/route`
  );
  const method = "POST";
  return route.POST(
    new Request(`${TEST_ORIGIN}/api/staff/conversations/${conversationId}/${action}`, {
      method,
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

async function escalate(): Promise<{ id: string; token: string }> {
  const conversation = await startConversation();
  await ask(conversation, "I need to speak to a human, please.");
  await confirmHandoffYes(conversation);
  return conversation;
}

async function staffId(email: string): Promise<string> {
  const { getChatbotService } = await import("../src/db/service");
  const { db } = await getChatbotService();
  return ((await db.get<{ id: string }>('SELECT "id" FROM "user" WHERE "email" = ?', email)) as {
    id: string;
  }).id;
}

beforeAll(async () => {
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  useTempDatabase();
  await warmChatbotService();
    await provisionStaff({ email: ALICE_EMAIL, password: ALICE_PASSWORD, name: "Alice" });
  await provisionStaff({ email: BOB_EMAIL, password: BOB_PASSWORD, name: "Bob" });
  aliceTotp = await enrollTotp(new CookieJar(), ALICE_EMAIL, ALICE_PASSWORD);
  bobTotp = await enrollTotp(new CookieJar(), BOB_EMAIL, BOB_PASSWORD);
});

describe("atomic claiming", () => {
  it("lets exactly one of two concurrent claimers win; the loser sees the owner", async () => {
    const conversation = await escalate();
    const aliceJar = new CookieJar();
    const bobJar = new CookieJar();
    await signInWithTotp(aliceJar, ALICE_EMAIL, ALICE_PASSWORD, aliceTotp);
    await signInWithTotp(bobJar, BOB_EMAIL, BOB_PASSWORD, bobTotp);

    const [aliceResult, bobResult] = await Promise.all([
      staffPost(aliceJar, conversation.id, "claim"),
      staffPost(bobJar, conversation.id, "claim"),
    ]);
    const statuses = [aliceResult.status, bobResult.status].sort();
    expect(statuses).toEqual([200, 409]);

    // Whoever won, the loser must see the winner as the current owner.
    const [winner, loser] =
      aliceResult.status === 200 ? [aliceResult, bobResult] : [bobResult, aliceResult];
    const winnerBody = (await winner.json()) as { conversation: { claimedBy: string } };
    const loserBody = (await loser.json()) as { claimedBy: string };
    const winnerIsAlice = winnerBody.conversation.claimedBy === (await staffId(ALICE_EMAIL));
    expect(loserBody.claimedBy).toBe(winnerIsAlice ? "Alice" : "Bob");

    // The conversation is claimed exactly once.
    const history = await loadHistory(conversation);
    const historyBody = (await history.json()) as { conversation: { state: string } };
    expect(historyBody.conversation.state).toBe("claimed");
  });

  it("rejects state-changing staff requests without a trusted Origin", async () => {
    const conversation = await escalate();
    const jar = new CookieJar();
    await signInWithTotp(jar, ALICE_EMAIL, ALICE_PASSWORD, aliceTotp);
    const { POST } = await import("../src/app/api/staff/conversations/[id]/claim/route");
    const response = await POST(
      new Request(`${TEST_ORIGIN}/api/staff/conversations/${conversation.id}/claim`, {
        method: "POST",
        headers: { cookie: jar.header(), origin: "https://evil.example.net" },
      }),
      { params: Promise.resolve({ id: conversation.id }) },
    );
    expect(response.status).toBe(403);
  });
});

describe("staff replies", () => {
  it("lets the claimer reply, and the visitor reads it in the same conversation", async () => {
    const conversation = await escalate();
    const jar = new CookieJar();
    await signInWithTotp(jar, ALICE_EMAIL, ALICE_PASSWORD, aliceTotp);
    const claim = await staffPost(jar, conversation.id, "claim");
    expect(claim.status).toBe(200);

    const reply = await staffPost(jar, conversation.id, "reply", {
      text: "Hi, Alice from the admissions office here. How can I help?",
    });
    expect(reply.status).toBe(200);

    const history = await loadHistory(conversation);
    const historyBody = (await history.json()) as {
      conversation: { state: string };
      messages: { role: string; text: string }[];
    };
    expect(historyBody.conversation.state).toBe("claimed");
    expect(historyBody.messages.at(-1)?.role).toBe("staff");
    expect(historyBody.messages.at(-1)?.text).toContain("Alice from the admissions office");
  });

  it("refuses replies before a claim and from anyone but the claimer", async () => {
    const unclaimed = await escalate();
    const aliceJar = new CookieJar();
    await signInWithTotp(aliceJar, ALICE_EMAIL, ALICE_PASSWORD, aliceTotp);
    const early = await staffPost(aliceJar, unclaimed.id, "reply", { text: "hello?" });
    expect(early.status).toBe(409);

    const conversation = await escalate();
    await staffPost(aliceJar, conversation.id, "claim");
    const bobJar = new CookieJar();
    await signInWithTotp(bobJar, BOB_EMAIL, BOB_PASSWORD, bobTotp);
    const reply = await staffPost(bobJar, conversation.id, "reply", { text: "Bob here" });
    expect(reply.status).toBe(409);
    const body = (await reply.json()) as { claimedBy: string };
    expect(body.claimedBy).toBe("Alice");
  });

  it("rejects an oversized or empty staff reply", async () => {
    const conversation = await escalate();
    const jar = new CookieJar();
    await signInWithTotp(jar, ALICE_EMAIL, ALICE_PASSWORD, aliceTotp);
    await staffPost(jar, conversation.id, "claim");

    const empty = await staffPost(jar, conversation.id, "reply", { text: "   " });
    expect(empty.status).toBe(400);
    const oversized = await staffPost(jar, conversation.id, "reply", { text: "a".repeat(1001) });
    expect(oversized.status).toBe(400);
  });
});

describe("reconnect and reload recovery", () => {
  it("serves the full stored history to both sides after a fresh read", async () => {
    const conversation = await escalate();
    const jar = new CookieJar();
    await signInWithTotp(jar, ALICE_EMAIL, ALICE_PASSWORD, aliceTotp);
    // The visitor's input is locked while staff help is requested (ticket
    // 43): Alice claims, and the visitor's follow-up lands under the claim.
    await staffPost(jar, conversation.id, "claim");
    await ask(conversation, "Second question after the handoff.");
    await staffPost(jar, conversation.id, "reply", { text: "Answering your second question now." });

    // A fresh visitor read (page reload / reconnect) recovers everything.
    const visitorHistory = await loadHistory(conversation);
    const visitorBody = (await visitorHistory.json()) as {
      messages: { role: string; text: string }[];
    };
    // Ticket 69: the phrase prompt and the visitor Yes choice sit between
    // the question and the takeover.
    expect(visitorBody.messages.map((message) => message.role)).toEqual([
      "visitor",
      "bot",
      "visitor",
      "bot",
      "visitor",
      "staff",
    ]);

    // A fresh staff read sees the same transcript.
    const { GET } = await import("../src/app/api/staff/conversations/[id]/route");
    const staffHistory = await GET(
      new Request(`${TEST_ORIGIN}/api/staff/conversations/${conversation.id}`, {
        headers: { cookie: jar.header() },
      }),
      { params: Promise.resolve({ id: conversation.id }) },
    );
    const staffBody = (await staffHistory.json()) as {
      messages: { role: string }[];
    };
    // Same transcript as the visitor's read, prompt + choice included.
    expect(staffBody.messages.map((message) => message.role)).toEqual([
      "visitor",
      "bot",
      "visitor",
      "bot",
      "visitor",
      "staff",
    ]);
  });

  it("keeps a visitor credential away from staff-only transcript access", async () => {
    const conversation = await escalate();
    const { GET } = await import("../src/app/api/staff/conversations/[id]/route");
    const response = await GET(
      new Request(`${TEST_ORIGIN}/api/staff/conversations/${conversation.id}`, {
        headers: { Authorization: `Bearer ${conversation.token}` },
      }),
      { params: Promise.resolve({ id: conversation.id }) },
    );
    expect(response.status).toBe(401);
  });
});

describe("closing a resolved conversation", () => {
  it("lets the claimer close; a later visitor question starts a new conversation", async () => {
    const conversation = await escalate();
    const jar = new CookieJar();
    await signInWithTotp(jar, ALICE_EMAIL, ALICE_PASSWORD, aliceTotp);
    await staffPost(jar, conversation.id, "claim");
    await staffPost(jar, conversation.id, "reply", { text: "Glad we sorted that out." });

    const close = await staffPost(jar, conversation.id, "close");
    expect(close.status).toBe(200);

    // The closed conversation no longer accepts visitor messages.
    const followUp = await ask(conversation, "One more thing about the form?");
    expect(followUp.status).toBe(409);
    const followUpBody = (await followUp.json()) as { error: { code: string } };
    expect(followUpBody.error.code).toBe("conversation_closed");

    // The visitor's next question starts a brand-new conversation that the
    // bot answers normally.
    const fresh = await startConversation();
    const answer = await ask(fresh, "What are the admission requirements?");
    expect(answer.status).toBe(200);
    const answerBody = (await answer.json()) as {
      conversation: { state: string };
      reply: { text: string } | null;
    };
    expect(fresh.id).not.toBe(conversation.id);
    expect(answerBody.conversation.state).toBe("bot_active");
    expect(answerBody.reply?.text).toContain("admissions portal");
  });

  it("refuses to close an unclaimed conversation", async () => {
    const conversation = await escalate();
    const jar = new CookieJar();
    await signInWithTotp(jar, ALICE_EMAIL, ALICE_PASSWORD, aliceTotp);
    const close = await staffPost(jar, conversation.id, "close");
    expect(close.status).toBe(409);
  });
});
