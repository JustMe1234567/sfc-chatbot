import { beforeAll, describe, expect, it } from "vitest";
import { ask, loadHistory, startConversation, testPostgresUrl, TEST_ORIGIN, useTempDatabase,
  countQuery,
} from "./helpers";
import { CookieJar, enrollTotp, provisionStaff, signInWithTotp } from "./auth-helpers";

const STAFF_EMAIL = "retry@example.edu";
const STAFF_PASSWORD = "retry-harbor-signal-27";

let staffTotp: Awaited<ReturnType<typeof enrollTotp>>;

interface OutboxMail {
  to_address: string;
  body: string;
}

async function outbox(): Promise<OutboxMail[]> {
  const { getChatbotService } = await import("../src/db/service");
  const { db } = await getChatbotService();
  return db.all<OutboxMail>(
    countQuery(
      "SELECT to_address, body FROM mail_outbox ORDER BY seq",
      "SELECT to_address, body FROM mail_outbox ORDER BY rowid",
    ),
  );
}

async function staffReply(conversationId: string, text: string): Promise<number> {
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
  expect(claim.status).toBe(200);
  const replyRoute = await import("../src/app/api/staff/conversations/[id]/reply/route");
  const reply = await replyRoute.POST(
    new Request(`${TEST_ORIGIN}/api/staff/conversations/${conversationId}/reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: jar.header(),
        origin: TEST_ORIGIN,
      },
      body: JSON.stringify({ text }),
    }),
    { params: Promise.resolve({ id: conversationId }) },
  );
  return reply.status;
}

async function retryNotification(notificationId: string): Promise<Response> {
  const jar = new CookieJar();
  await signInWithTotp(jar, STAFF_EMAIL, STAFF_PASSWORD, staffTotp);
  const { POST } = await import("../src/app/api/staff/notifications/[id]/retry/route");
  return POST(
    new Request(`${TEST_ORIGIN}/api/staff/notifications/${notificationId}/retry`, {
      method: "POST",
      headers: { cookie: jar.header(), origin: TEST_ORIGIN },
    }),
    { params: Promise.resolve({ id: notificationId }) },
  );
}

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  // The first send app-wide fails, exactly like an unreachable provider.
  process.env.CHATBOT_MAIL_TRANSPORT = "fail-then-succeed";
  const { warmChatbotService } = await import("./helpers");
  await warmChatbotService();
  process.env.VISITOR_PRESENCE_WINDOW_MS = "1";
  process.env.RETURN_LINK_TTL_MS = String(24 * 60 * 60 * 1000);
  await provisionStaff({ email: STAFF_EMAIL, password: STAFF_PASSWORD, name: "Rita" });
  staffTotp = await enrollTotp(new CookieJar(), STAFF_EMAIL, STAFF_PASSWORD);
});

describe("retrying a failed visitor return notification", () => {
  it("mints a fresh working link on retry; the delivered email is never stale", async () => {
    const conversation = await startConversation();
    await ask(conversation, "Tell me about campus tours, no rule covers this.");
    const emailRoute = await import("../src/app/api/v1/conversations/[id]/email/route");
    const email = await emailRoute.POST(
      new Request(`${TEST_ORIGIN}/api/v1/conversations/${conversation.id}/email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${conversation.token}`,
        },
        body: JSON.stringify({ email: "retry-me@example.org" }),
      }),
      { params: Promise.resolve({ id: conversation.id }) },
    );
    expect(email.status).toBe(200);
    await loadHistory(conversation);
    await new Promise((resolve) => setTimeout(resolve, 20));

    // The provider is down: the reply succeeds, the email fails, nothing is
    // delivered, and the failure is recorded for staff retry.
    expect(await staffReply(conversation.id, "Campus tours run Tuesdays.")).toBe(200);
    expect(await outbox()).toHaveLength(0);
    const { getChatbotService } = await import("../src/db/service");
    const { db } = await getChatbotService();
    const row = (await db.get<{ id: string; status: string }>(
      "SELECT id, status FROM notifications WHERE type = 'visitor_return'",
    )) as { id: string; status: string };
    expect(row.status).toBe("failed");

    const retried = await retryNotification(row.id);
    expect(retried.status).toBe(200);

    const delivered = (await outbox()).find((mail) => mail.to_address === "retry-me@example.org");
    expect(delivered).toBeTruthy();
    const match = delivered!.body.match(/return\?token=([A-Za-z0-9_-]+)/);
    expect(match?.[1]).toBeTruthy();

    const { POST: redeem } = await import("../src/app/api/v1/return/route");
    const redemption = await redeem(
      new Request(`${TEST_ORIGIN}/api/v1/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: match![1] }),
      }),
    );
    expect(redemption.status).toBe(200);
    const session = (await redemption.json()) as { id: string; token: string };
    expect(session.id).toBe(conversation.id);
  });
});
