import { beforeAll, describe, expect, it } from "vitest";
import { askRaw, startConversation, submitContact, TEST_ORIGIN, useTempDatabase, warmChatbotService, type ConversationStart } from "./helpers";
import { CookieJar, provisionStaff, signInAs } from "./auth-helpers";

const STAFF_EMAIL = "lock-staff@example.edu";
const STAFF_PASSWORD = "lock-staff-password-1";

async function postMessage(
  conversation: ConversationStart,
  body: Record<string, unknown>,
): Promise<Response> {
  const { POST } = await import("../src/app/api/v1/conversations/[id]/messages/route");
  return POST(
    new Request(`${TEST_ORIGIN}/api/v1/conversations/${conversation.id}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${conversation.token}`,
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: conversation.id }) },
  );
}

async function loadHistory(conversation: ConversationStart): Promise<Response> {
  const { GET } = await import("../src/app/api/v1/conversations/[id]/messages/route");
  return GET(
    new Request(`${TEST_ORIGIN}/api/v1/conversations/${conversation.id}/messages`, {
      headers: { Authorization: `Bearer ${conversation.token}` },
    }),
    { params: Promise.resolve({ id: conversation.id }) },
  );
}

async function staffClaim(jar: CookieJar, conversationId: string): Promise<Response> {
  const { POST } = await import("../src/app/api/staff/conversations/[id]/claim/route");
  return POST(
    new Request(`${TEST_ORIGIN}/api/staff/conversations/${conversationId}/claim`, {
      method: "POST",
      headers: { cookie: jar.header(), origin: TEST_ORIGIN },
    }),
    { params: Promise.resolve({ id: conversationId }) },
  );
}

beforeAll(async () => {
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  useTempDatabase();
  await warmChatbotService();
  await provisionStaff({ email: STAFF_EMAIL, password: STAFF_PASSWORD, name: "Lock Staff" });
});

describe("visitor messaging stays open while waiting for staff (ticket 103)", () => {
  it("records visitor messages while awaiting_staff with no bot reply, and keeps them flowing after takeover", async () => {
    const conversation = await startConversation();

    // An unknown question offers the human request; taking it escalates.
    const offer = await postMessage(conversation, { text: "What is the meaning of life?" });
    expect(offer.status).toBe(200);
    const offerBody = (await offer.json()) as {
      reply: { choices: { id: string }[] } | null;
    };
    expect(offerBody.reply?.choices?.some((choice) => choice.id === "request-human")).toBe(true);

    const takeover = await postMessage(conversation, { choice: "request-human" });
    expect(takeover.status).toBe(200);
    expect(((await takeover.json()) as { conversation: { state: string } }).conversation.state).toBe(
      "awaiting_staff",
    );

    // Open composer while waiting: a typed message is recorded for the
    // claiming advisor — including a question a published rule would
    // answer — but draws no bot reply while the bot is paused.
    const waiting = await postMessage(conversation, {
      text: "What are the admission requirements?",
    });
    expect(waiting.status).toBe(200);
    const waitingBody = (await waiting.json()) as {
      conversation: { state: string };
      reply: unknown;
    };
    expect(waitingBody.conversation.state).toBe("awaiting_staff");
    expect(waitingBody.reply).toBeNull();

    const history = await loadHistory(conversation);
    const historyBody = (await history.json()) as {
      conversation: { state: string };
      messages: { role: string; text: string }[];
    };
    expect(historyBody.conversation.state).toBe("awaiting_staff");
    expect(historyBody.messages.at(-1)?.role).toBe("visitor");
    expect(historyBody.messages.at(-1)?.text).toBe("What are the admission requirements?");
    // The transcript ends on the visitor's words: the escalation reply is
    // the last bot message, and no answer-rule match fired.
    expect(historyBody.messages.filter((message) => message.role === "bot")).toHaveLength(2);

    // Staff takeover keeps the flow open: messages still record for the
    // advisor, with no bot answer, without any visitor-side reset.
    const jar = new CookieJar();
    await signInAs(jar, STAFF_EMAIL, STAFF_PASSWORD);
    const claim = await staffClaim(jar, conversation.id);
    expect(claim.status).toBe(200);

    const unlocked = await postMessage(conversation, { text: "Great, thanks for taking over." });
    expect(unlocked.status).toBe(200);
    const unlockedBody = (await unlocked.json()) as {
      conversation: { state: string };
      reply: unknown;
    };
    expect(unlockedBody.conversation.state).toBe("claimed");
    expect(unlockedBody.reply).toBeNull();
  });

  it("refuses stale prompt choices gracefully while waiting (prompt staleness, not an input lock)", async () => {
    const conversation = await startConversation();

    await postMessage(conversation, { text: "What is the meaning of life?" });
    const takeover = await postMessage(conversation, { choice: "request-human" });
    expect(takeover.status).toBe(200);

    // The offer is no longer the last message, so a replayed choice cannot
    // fire: the persisted-prompt staleness check refuses it with the
    // standard invalid-choice error — not a waiting-lock 409.
    const stale = await postMessage(conversation, { choice: "request-human" });
    expect(stale.status).toBe(400);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe("invalid_choice");

    // An unknown choice id draws the same graceful refusal.
    const unknown = await postMessage(conversation, { choice: "no-such-choice" });
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe("invalid_choice");
  });

  it("a failed human request leaves the conversation unlocked", async () => {
    const conversation = await startConversation();

    // No offer is on the last message, so the request-human choice fails
    // without escalating — and must not lock anything.
    const failed = await postMessage(conversation, { choice: "request-human" });
    expect(failed.status).toBe(400);

    const after = await postMessage(conversation, { text: "An ordinary question" });
    expect(after.status).toBe(200);
  });

  it("a fresh conversation after Clear requires contact details again", async () => {
    const conversation = await startConversation();
    await postMessage(conversation, { text: "I need to speak to a human, please." });
    // The phrase asks first now (ticket 69); Yes escalates while messaging
    // stays open (ticket 103).
    await askRaw(conversation, JSON.stringify({ choice: "handoff-yes" }));
    const waiting = await postMessage(conversation, { text: "Still there?" });
    expect(waiting.status).toBe(200);

    const { POST: clearRoute } = await import(
      "../src/app/api/v1/conversations/[id]/clear/route"
    );
    const clear = await clearRoute(
      new Request(`${TEST_ORIGIN}/api/v1/conversations/${conversation.id}/clear`, {
        method: "POST",
        headers: { Authorization: `Bearer ${conversation.token}` },
      }),
      { params: Promise.resolve({ id: conversation.id }) },
    );
    expect(clear.status).toBe(200);
    const successor = (await clear.json()) as ConversationStart;

    // The successor starts locked (ticket 66): nothing is accepted until
    // the contact form's details land on it — then it chats normally.
    const gated = await postMessage(successor, { text: "Fresh chat works again" });
    expect(gated.status).toBe(409);
    expect((await submitContact(successor)).status).toBe(200);
    const fresh = await postMessage(successor, { text: "Fresh chat works again" });
    expect(fresh.status).toBe(200);
  });
});
