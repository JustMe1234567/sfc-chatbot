import { beforeAll, describe, expect, it } from "vitest";
import { ask, startConversation, testPostgresUrl, TEST_ORIGIN,
  warmChatbotService,
  countQuery,
  confirmHandoffYes,
} from "./helpers";
import {
  authRequest,
  CookieJar,
  enrollTotp,
  provisionStaff,
  signInWithTotp,
  useTempDatabase,
} from "./auth-helpers";

const OWNER_EMAIL = "retry-owner@example.edu";
const OWNER_PASSWORD = "retry-owner-password-1";
const RECIPIENT = "escalations@example.edu";

let ownerTotp: Awaited<ReturnType<typeof enrollTotp>>;

async function retryNotification(
  jar: CookieJar,
  notificationId: string,
): Promise<Response> {
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
  // Both env values must precede service init: the transport is chosen when
  // the singleton builds, and this module's app uses one whose first attempt
  // fails and later attempts succeed — exactly the failure-then-retry story
  // of this suite.
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  process.env.CHATBOT_MAIL_TRANSPORT = "fail-then-succeed";
  useTempDatabase();
  await warmChatbotService();
  await provisionStaff({ email: OWNER_EMAIL, password: OWNER_PASSWORD, name: "Owner", role: "owner" });
  ownerTotp = await enrollTotp(new CookieJar(), OWNER_EMAIL, OWNER_PASSWORD);

  const jar = new CookieJar();
  await signInWithTotp(jar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
  const { PUT } = await import("../src/app/api/staff/settings/alert-recipients/route");
  await PUT(
    new Request(`${TEST_ORIGIN}/api/staff/settings/alert-recipients`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie: jar.header(), origin: TEST_ORIGIN },
      body: JSON.stringify({ recipients: [RECIPIENT] }),
    }),
  );
});

describe("escalation alert failure and retry", () => {
  it("records a failed delivery with its reason when the sender fails", async () => {
    const conversation = await startConversation();
    await ask(conversation, "Can I speak to a human about my invoice?");
    await confirmHandoffYes(conversation);

    const jar = new CookieJar();
    await signInWithTotp(jar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    const { GET } = await import("../src/app/api/staff/notifications/route");
    const response = await GET(
      new Request(`${TEST_ORIGIN}/api/staff/notifications`, {
        headers: { cookie: jar.header() },
      }),
    );
    const body = (await response.json()) as {
      notifications: { id: string; conversationId: string; status: string; lastError: string | null }[];
    };
    const alert = body.notifications.find((item) => item.conversationId === conversation.id);
    expect(alert?.status).toBe("failed");
    expect(alert?.lastError).toContain("sender refused");

    // Nothing reached the recipient.
    const { getChatbotService } = await import("../src/db/service");
    const { db } = await getChatbotService();
    const mails = await db.get<{ count: number }>(
      countQuery(
        "SELECT COUNT(*)::int AS count FROM mail_outbox WHERE to_address = ?",
        "SELECT COUNT(*) AS count FROM mail_outbox WHERE to_address = ?",
      ),
      RECIPIENT,
    ) as { count: number };
    expect(mails.count).toBe(0);
  });

  it("retries the failed notification to success without duplicating", async () => {
    // The failed alert from the previous test is the one staff would see.
    const jar = new CookieJar();
    await signInWithTotp(jar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    const { GET } = await import("../src/app/api/staff/notifications/route");
    const list = await GET(
      new Request(`${TEST_ORIGIN}/api/staff/notifications`, {
        headers: { cookie: jar.header() },
      }),
    );
    const listBody = (await list.json()) as {
      notifications: { id: string; status: string }[];
    };
    const failed = listBody.notifications.find((item) => item.status === "failed");
    expect(failed).toBeDefined();

    const retry = await retryNotification(jar, failed!.id);
    expect(retry.status).toBe(200);
    const retried = (await retry.json()) as { status: string };
    expect(retried.status).toBe("sent");

    // Exactly one successful delivery exists for that conversation.
    const { getChatbotService } = await import("../src/db/service");
    const { db } = await getChatbotService();
    const mails = await db.all<{ to_address: string }>(
      "SELECT to_address FROM mail_outbox WHERE to_address = ?",
      RECIPIENT,
    );
    expect(mails).toHaveLength(1);
  });

  it("refuses to retry an already-sent alert", async () => {
    // Any escalation now succeeds on first attempt (the transport only fails
    // once), producing a sent notification whose retry must be refused.
    const conversation = await startConversation();
    await ask(conversation, "Can I speak to a human about evening classes for adults?");
    await confirmHandoffYes(conversation);

    const jar = new CookieJar();
    await signInWithTotp(jar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    const { GET } = await import("../src/app/api/staff/notifications/route");
    const list = await GET(
      new Request(`${TEST_ORIGIN}/api/staff/notifications`, {
        headers: { cookie: jar.header() },
      }),
    );
    const listBody = (await list.json()) as {
      notifications: { id: string; conversationId: string; status: string }[];
    };
    const alert = listBody.notifications.find((item) => item.conversationId === conversation.id);
    expect(alert?.status).toBe("sent");

    const retry = await retryNotification(jar, alert!.id);
    expect(retry.status).toBe(409);
  });
});
