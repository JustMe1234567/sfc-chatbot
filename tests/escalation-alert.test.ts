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

const OWNER_EMAIL = "alert-owner@example.edu";
const OWNER_PASSWORD = "alert-owner-password-1";
const RECIPIENT = "front-desk@example.edu";

let ownerTotp: Awaited<ReturnType<typeof enrollTotp>>;

async function setRecipients(jar: CookieJar, recipients: string[]): Promise<Response> {
  const { PUT } = await import("../src/app/api/staff/settings/alert-recipients/route");
  return PUT(
    new Request(`${TEST_ORIGIN}/api/staff/settings/alert-recipients`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie: jar.header(), origin: TEST_ORIGIN },
      body: JSON.stringify({ recipients }),
    }),
  );
}

async function listNotifications(jar: CookieJar): Promise<Response> {
  const { GET } = await import("../src/app/api/staff/notifications/route");
  return GET(
    new Request(`${TEST_ORIGIN}/api/staff/notifications`, {
      headers: { cookie: jar.header() },
    }),
  );
}

beforeAll(async () => {
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  useTempDatabase();
  await warmChatbotService();
    await provisionStaff({ email: OWNER_EMAIL, password: OWNER_PASSWORD, name: "Owner", role: "owner" });
  ownerTotp = await enrollTotp(new CookieJar(), OWNER_EMAIL, OWNER_PASSWORD);
});

describe("escalations before recipients are configured", () => {
  it("records a visible pending alert that retry delivers once configured", async () => {
    // No recipients yet: the escalation must still leave a visible record.
    const conversation = await startConversation();
    await ask(conversation, "Can I speak to a human about visiting campus this weekend?");
    await confirmHandoffYes(conversation);

    const jar = new CookieJar();
    await signInWithTotp(jar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    let list = await listNotifications(jar);
    let body = (await list.json()) as {
      notifications: { id: string; conversationId: string; status: string; lastError: string | null }[];
    };
    const pending = body.notifications.find((item) => item.conversationId === conversation.id);
    expect(pending?.status).toBe("pending");
    expect(pending?.lastError).toContain("No alert recipients configured");

    const { getChatbotService } = await import("../src/db/service");
    const { db } = await getChatbotService();
    let mails = await db.get<{ count: number }>(
      countQuery(
        "SELECT COUNT(*)::int AS count FROM mail_outbox WHERE to_address = ?",
        "SELECT COUNT(*) AS count FROM mail_outbox WHERE to_address = ?",
      ),
      RECIPIENT,
    ) as { count: number };
    expect(mails.count).toBe(0);

    // The owner configures recipients; retry delivers to the current list.
    await setRecipients(jar, [RECIPIENT]);
    const { POST } = await import("../src/app/api/staff/notifications/[id]/retry/route");
    const retry = await POST(
      new Request(`${TEST_ORIGIN}/api/staff/notifications/${pending!.id}/retry`, {
        method: "POST",
        headers: { cookie: jar.header(), origin: TEST_ORIGIN },
      }),
      { params: Promise.resolve({ id: pending!.id }) },
    );
    expect(retry.status).toBe(200);
    const retried = (await retry.json()) as { status: string };
    expect(retried.status).toBe("sent");

    mails = await db.get<{ count: number }>(
      testPostgresUrl()
        ? "SELECT COUNT(*)::int AS count FROM mail_outbox WHERE to_address = ?"
        : "SELECT COUNT(*) AS count FROM mail_outbox WHERE to_address = ?",
      RECIPIENT,
    ) as { count: number };
    expect(mails.count).toBe(1);
  });
});

describe("staff alert destination configuration", () => {
  it("lets the owner set and read the alert recipients", async () => {
    const jar = new CookieJar();
    await signInWithTotp(jar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);

    const put = await setRecipients(jar, [RECIPIENT, "backoffice@example.edu"]);
    expect(put.status).toBe(200);

    const { GET } = await import("../src/app/api/staff/settings/alert-recipients/route");
    const get = await GET(
      new Request(`${TEST_ORIGIN}/api/staff/settings/alert-recipients`, {
        headers: { cookie: jar.header() },
      }),
    );
    expect(get.status).toBe(200);
    const body = (await get.json()) as { recipients: string[] };
    expect(body.recipients).toEqual([RECIPIENT, "backoffice@example.edu"]);
  });

  it("rejects invalid recipient lists", async () => {
    const jar = new CookieJar();
    await signInWithTotp(jar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    const put = await setRecipients(jar, ["not-an-email"]);
    expect(put.status).toBe(400);
  });
});

describe("one escalation alert per conversation", () => {
  it("sends exactly one staff alert when a conversation first escalates", async () => {
    const jar = new CookieJar();
    await signInWithTotp(jar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    await setRecipients(jar, [RECIPIENT]);

    const conversation = await startConversation();
    const response = await ask(conversation, "Can I speak to a human about my application form?");
    await confirmHandoffYes(conversation);
    expect(response.status).toBe(200);

    const notifications = await listNotifications(jar);
    expect(notifications.status).toBe(200);
    const body = (await notifications.json()) as {
      notifications: { conversationId: string; status: string; recipients: string[] }[];
    };
    const alert = body.notifications.find((item) => item.conversationId === conversation.id);
    expect(alert?.status).toBe("sent");
    expect(alert?.recipients).toEqual([RECIPIENT]);

    const { getChatbotService } = await import("../src/db/service");
    const { db } = await getChatbotService();
    // The alert for THIS conversation links to it, distinguishing it from
    // alerts delivered by earlier tests in this file.
    const mails = await db.all<{ to_address: string; subject: string; body: string }>(
      "SELECT to_address, subject, body FROM mail_outbox WHERE to_address = ? AND body LIKE ?",
      RECIPIENT, `%${conversation.id}%`,
    );
    expect(mails).toHaveLength(1);
    // The alert links to the protected conversation, contains no transcript
    // excerpt and no visitor credential.
    expect(mails[0]!.body).toContain(`/dashboard/conversations/${conversation.id}`);
    expect(mails[0]!.body).not.toContain("post my application form");
    expect(mails[0]!.body).not.toContain(conversation.token);
  });

  it("does not alert again when further visitor input is rejected while waiting", async () => {
    const jar = new CookieJar();
    await signInWithTotp(jar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);

    const conversation = await startConversation();
    await ask(conversation, "Can I speak to a human about parking validation?");
    await confirmHandoffYes(conversation);
    // Ticket 43: input is locked while staff help is requested but unclaimed
    // — further messages are rejected, so nothing can re-trigger the alert.
    const second = await ask(conversation, "Also, what are your opening hours?");
    expect(second.status).toBe(409);
    const third = await ask(conversation, "Hello?");
    expect(third.status).toBe(409);

    const { getChatbotService } = await import("../src/db/service");
    const { db } = await getChatbotService();
    const alerts = await db.get<{ count: number }>(
      countQuery(
        "SELECT COUNT(*)::int AS count FROM notifications WHERE type = 'escalation_alert' AND conversation_id = ?",
        "SELECT COUNT(*) AS count FROM notifications WHERE type = 'escalation_alert' AND conversation_id = ?",
      ),
      conversation.id,
    ) as { count: number };
    expect(alerts.count).toBe(1);
  });
});

describe("notification visibility and retry authorization", () => {
  it("rejects unauthenticated and visitor access to notifications", async () => {
    const anonymous = await listNotifications(new CookieJar());
    expect(anonymous.status).toBe(401);

    const conversation = await startConversation();
    const { GET } = await import("../src/app/api/staff/notifications/route");
    const visitor = await GET(
      new Request(`${TEST_ORIGIN}/api/staff/notifications`, {
        headers: { Authorization: `Bearer ${conversation.token}` },
      }),
    );
    expect(visitor.status).toBe(401);
  });
});
