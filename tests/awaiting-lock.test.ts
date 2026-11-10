import { beforeAll, describe, expect, it } from "vitest";
import { startConversation, submitContact, TEST_ORIGIN, useTempDatabase, warmChatbotService, type ConversationStart } from "./helpers";
import { CookieJar, enrollTotp, provisionStaff, signInWithTotp } from "./auth-helpers";

const STAFF_EMAIL = "lock-staff@example.edu";
const STAFF_PASSWORD = "lock-staff-password-1";

let staffTotp: Awaited<ReturnType<typeof enrollTotp>>;

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
  staffTotp = await enrollTotp(new CookieJar(), STAFF_EMAIL, STAFF_PASSWORD);
});

describe("visitor input lock while waiting for staff (ticket 43)", () => {
  it("rejects visitor messages with a stable error while awaiting_staff and unlocks on takeover", async () => {
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

    // Locked: direct text and repeated choices both draw the stable error.
    const rejectedText = await postMessage(conversation, { text: "Hello while waiting?" });
    expect(rejectedText.status).toBe(409);
    expect(((await rejectedText.json()) as { error: { code: string } }).error.code).toBe(
      "awaiting_staff",
    );
    const rejectedChoice = await postMessage(conversation, { choice: "request-human" });
    expect(rejectedChoice.status).toBe(409);

    // Staff takeover unlocks input without any visitor-side reset.
    const jar = new CookieJar();
    await signInWithTotp(jar, STAFF_EMAIL, STAFF_PASSWORD, staffTotp);
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
    const locked = await postMessage(conversation, { text: "Still waiting?" });
    expect(locked.status).toBe(409);

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
