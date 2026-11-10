import { beforeAll, describe, expect, it } from "vitest";
import { ask, startConversation, TEST_ORIGIN, useTempDatabase, countQuery } from "./helpers";
import { CookieJar, enrollTotp, provisionStaff, signInWithTotp } from "./auth-helpers";

/**
 * Ticket 66 retired visitor return-link emails. A failed visitor-return
 * notification can still sit in the delivery history from before that
 * change; staff retry must refuse it outright — no fresh link minted, no
 * mail sent — while escalation alerts keep their retry.
 */

const STAFF_EMAIL = "retry@example.edu";
const STAFF_PASSWORD = "retry-harbor-signal-27";

let staffTotp: Awaited<ReturnType<typeof enrollTotp>>;

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

async function count(postgresSql: string, sqliteSql: string, ...params: string[]): Promise<number> {
  const { getChatbotService } = await import("../src/db/service");
  const { db } = await getChatbotService();
  const row = (await db.get<{ n: number }>(countQuery(postgresSql, sqliteSql), ...params)) as {
    n: number;
  };
  return Number(row.n);
}

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  const { warmChatbotService } = await import("./helpers");
  await warmChatbotService();
  await provisionStaff({ email: STAFF_EMAIL, password: STAFF_PASSWORD, name: "Rita" });
  staffTotp = await enrollTotp(new CookieJar(), STAFF_EMAIL, STAFF_PASSWORD);
});

describe("retrying a legacy visitor return notification", () => {
  it("is refused without minting a link or sending mail", async () => {
    const conversation = await startConversation({ email: "retry-me@example.org" });
    await ask(conversation, "Tell me about campus tours; I need to speak to a human.");

    // A failed visitor-return row exactly as the pre-ticket delivery left it.
    const { getChatbotService } = await import("../src/db/service");
    const { db } = await getChatbotService();
    const notificationId = crypto.randomUUID();
    await db.run(
      `INSERT INTO notifications (id, type, conversation_id, recipients, status, attempts, last_error, created_at)
       VALUES (?, 'visitor_return', ?, ?, 'failed', 1, 'provider unreachable', ?)`,
      notificationId,
      conversation.id,
      JSON.stringify(["retry-me@example.org"]),
      new Date().toISOString(),
    );
    const mailBefore = await count(
      "SELECT COUNT(*)::int AS n FROM mail_outbox",
      "SELECT COUNT(*) AS n FROM mail_outbox",
    );

    const retried = await retryNotification(notificationId);
    expect(retried.status).toBe(409);
    const body = (await retried.json()) as { error: { code: string } };
    expect(body.error.code).toBe("visitor_return_retired");

    // Nothing was mailed, no link exists, and the row is untouched.
    expect(
      await count(
        "SELECT COUNT(*)::int AS n FROM mail_outbox",
        "SELECT COUNT(*) AS n FROM mail_outbox",
      ),
    ).toBe(mailBefore);
    expect(
      await count(
        "SELECT COUNT(*)::int AS n FROM return_tokens WHERE conversation_id = ?",
        "SELECT COUNT(*) AS n FROM return_tokens WHERE conversation_id = ?",
        conversation.id,
      ),
    ).toBe(0);
    const row = (await db.get<{ status: string; attempts: number }>(
      "SELECT status, attempts FROM notifications WHERE id = ?",
      notificationId,
    )) as { status: string; attempts: number };
    expect(row.status).toBe("failed");
    expect(Number(row.attempts)).toBe(1);
  });
});
