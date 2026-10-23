import { beforeAll, describe, expect, it } from "vitest";
import { ask, loadHistory, startConversation, TEST_ORIGIN, useTempDatabase, warmChatbotService, type ConversationStart } from "./helpers";
import {
  CookieJar,
  enrollTotp,
  provisionStaff,
  signInWithTotp,
} from "./auth-helpers";

const OWNER_EMAIL = "owner@example.edu";
const OWNER_PASSWORD = "owner-retain-lighthouse-71";
const STAFF_EMAIL = "helper@example.edu";
const STAFF_PASSWORD = "helper-retain-porch-4n";
const EDITOR_EMAIL = "editor@example.edu";
const EDITOR_PASSWORD = "editor-retain-quartz-9k";

let ownerTotp: Awaited<ReturnType<typeof enrollTotp>>;
let staffTotp: Awaited<ReturnType<typeof enrollTotp>>;
let editorTotp: Awaited<ReturnType<typeof enrollTotp>>;

const RETENTION_PATH = "/api/staff/settings/transcript-retention";

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function putRetention(jar: CookieJar | null, days: unknown, origin = TEST_ORIGIN): Promise<Response> {
  const { PUT } = await import("../src/app/api/staff/settings/transcript-retention/route");
  return PUT(
    new Request(`${TEST_ORIGIN}${RETENTION_PATH}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(jar ? { cookie: jar.header() } : {}),
        origin,
      },
      body: JSON.stringify({ days }),
    }),
  );
}

async function getRetention(jar: CookieJar): Promise<{ days: number | null }> {
  const { GET } = await import("../src/app/api/staff/settings/transcript-retention/route");
  const response = await GET(
    new Request(`${TEST_ORIGIN}${RETENTION_PATH}`, { headers: { cookie: jar.header() } }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as { days: number | null };
}

async function staffAction(
  jar: CookieJar,
  conversationId: string,
  action: "claim" | "close",
): Promise<Response> {
  const route = await import(`../src/app/api/staff/conversations/[id]/${action}/route`);
  return route.POST(
    new Request(`${TEST_ORIGIN}/api/staff/conversations/${conversationId}/${action}`, {
      method: "POST",
      headers: { cookie: jar.header(), origin: TEST_ORIGIN },
    }),
    { params: Promise.resolve({ id: conversationId }) },
  );
}

async function staffDetail(jar: CookieJar, conversationId: string): Promise<Response> {
  const { GET } = await import("../src/app/api/staff/conversations/[id]/route");
  return GET(
    new Request(`${TEST_ORIGIN}/api/staff/conversations/${conversationId}`, {
      headers: { cookie: jar.header() },
    }),
    { params: Promise.resolve({ id: conversationId }) },
  );
}

async function inboxGet(jar: CookieJar): Promise<Response> {
  const { GET } = await import("../src/app/api/staff/conversations/route");
  return GET(
    new Request(`${TEST_ORIGIN}/api/staff/conversations`, { headers: { cookie: jar.header() } }),
  );
}

/** Escalate (optionally leave an email), claim, and close — a finished conversation. */
async function closedConversation(email?: string): Promise<ConversationStart> {
  const conversation = await startConversation();
  await ask(conversation, "Nothing approved covers this, I need a person.");
  if (email) {
    const { POST } = await import("../src/app/api/v1/conversations/[id]/email/route");
    const response = await POST(
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
    expect(response.status).toBe(200);
  }
  const jar = new CookieJar();
  await signInWithTotp(jar, STAFF_EMAIL, STAFF_PASSWORD, staffTotp);
  expect((await staffAction(jar, conversation.id, "claim")).status).toBe(200);
  expect((await staffAction(jar, conversation.id, "close")).status).toBe(200);
  return conversation;
}

/** A claimed-but-open conversation, for the "active is preserved" checks. */
async function claimedConversation(): Promise<ConversationStart> {
  const conversation = await startConversation();
  await ask(conversation, "Please hand this to the desk, nothing covers it.");
  const jar = new CookieJar();
  await signInWithTotp(jar, STAFF_EMAIL, STAFF_PASSWORD, staffTotp);
  expect((await staffAction(jar, conversation.id, "claim")).status).toBe(200);
  return conversation;
}

async function sql<T>(query: string, ...params: (string | number)[]): Promise<T> {
  const { getChatbotService } = await import("../src/db/service");
  const { db } = await getChatbotService();
  return db.prepare(query).get(...params) as T;
}

async function setClosedAt(conversationId: string, iso: string): Promise<void> {
  const { getChatbotService } = await import("../src/db/service");
  const { db } = await getChatbotService();
  db.prepare("UPDATE conversations SET closed_at = ? WHERE id = ?").run(iso, conversationId);
}

async function setCreatedAt(conversationId: string, iso: string): Promise<void> {
  const { getChatbotService } = await import("../src/db/service");
  const { db } = await getChatbotService();
  db.prepare("UPDATE conversations SET created_at = ? WHERE id = ?").run(iso, conversationId);
}

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await warmChatbotService();
  await provisionStaff({ email: OWNER_EMAIL, password: OWNER_PASSWORD, name: "Olive", role: "owner" });
  await provisionStaff({ email: STAFF_EMAIL, password: STAFF_PASSWORD, name: "Sam" });
  await provisionStaff({ email: EDITOR_EMAIL, password: EDITOR_PASSWORD, name: "Eddie", role: "editor" });
  ownerTotp = await enrollTotp(new CookieJar(), OWNER_EMAIL, OWNER_PASSWORD);
  staffTotp = await enrollTotp(new CookieJar(), STAFF_EMAIL, STAFF_PASSWORD);
  editorTotp = await enrollTotp(new CookieJar(), EDITOR_EMAIL, EDITOR_PASSWORD);
});

describe("the owner configures transcript retention", () => {
  it("sets, changes, and clears the retention period", async () => {
    const ownerJar = new CookieJar();
    await signInWithTotp(ownerJar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    expect((await getRetention(ownerJar)).days).toBeNull();

    const saved = await putRetention(ownerJar, 30);
    expect(saved.status).toBe(200);
    expect((await getRetention(ownerJar)).days).toBe(30);

    const changed = await putRetention(ownerJar, 14);
    expect(changed.status).toBe(200);
    expect((await getRetention(ownerJar)).days).toBe(14);

    const cleared = await putRetention(ownerJar, null);
    expect(cleared.status).toBe(200);
    expect((await getRetention(ownerJar)).days).toBeNull();
  });

  it("rejects malformed periods", async () => {
    const ownerJar = new CookieJar();
    await signInWithTotp(ownerJar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    for (const bad of [0, -5, 3651, 2.5, "30", true]) {
      const response = await putRetention(ownerJar, bad);
      expect(response.status).toBe(400);
    }
    const missing = await putRetention(ownerJar, undefined);
    expect(missing.status).toBe(400);
    // Nothing above may have half-saved a value.
    expect((await getRetention(ownerJar)).days).toBeNull();
  });

  it("is owner-only and origin-checked", async () => {
    const staffJar = new CookieJar();
    await signInWithTotp(staffJar, STAFF_EMAIL, STAFF_PASSWORD, staffTotp);
    expect((await putRetention(staffJar, 30)).status).toBe(403);
    const staffRead = await getRetention(staffJar).catch(() => null);
    expect(staffRead).toBeNull();

    const editorJar = new CookieJar();
    await signInWithTotp(editorJar, EDITOR_EMAIL, EDITOR_PASSWORD, editorTotp);
    expect((await putRetention(editorJar, 30)).status).toBe(403);

    const ownerJar = new CookieJar();
    await signInWithTotp(ownerJar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    expect((await putRetention(ownerJar, 30, "https://evil.example.net")).status).toBe(403);
    expect((await putRetention(null, 30)).status).toBe(401);
  });

  it("records no cleanup result while nothing has been removed", async () => {
    // Configuring retention alone must not spam the operator's cleanup record.
    const runs = await sql<{ n: number }>("SELECT COUNT(*) AS n FROM retention_runs");
    expect(runs.n).toBe(0);
  });
});

describe("cleanup removes only closed conversations past the period", () => {
  it("keeps active and recent conversations, removes the expired one with its data", async () => {
    const ownerJar = new CookieJar();
    await signInWithTotp(ownerJar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    const saved = await putRetention(ownerJar, 30);
    expect(saved.status).toBe(200);

    const expired = await closedConversation("visitor@example.net");
    await setClosedAt(expired.id, daysAgo(31));

    const recentlyClosed = await closedConversation();
    await setClosedAt(recentlyClosed.id, daysAgo(29));

    const awaiting = await startConversation();
    await ask(awaiting, "Nothing covers this ancient question.");
    await setCreatedAt(awaiting.id, daysAgo(60));

    const claimed = await claimedConversation();
    await setCreatedAt(claimed.id, daysAgo(60));

    const botActive = await startConversation();
    await setCreatedAt(botActive.id, daysAgo(60));

    // Ordinary staff traffic runs the automated cleanup.
    const staffJar = new CookieJar();
    await signInWithTotp(staffJar, STAFF_EMAIL, STAFF_PASSWORD, staffTotp);
    const inbox = await inboxGet(staffJar);
    expect(inbox.status).toBe(200);

    const staffRead = new CookieJar();
    await signInWithTotp(staffRead, STAFF_EMAIL, STAFF_PASSWORD, staffTotp);
    expect((await staffDetail(staffRead, expired.id)).status).toBe(404);
    for (const survivor of [recentlyClosed, awaiting, claimed, botActive]) {
      expect((await staffDetail(staffRead, survivor.id)).status).toBe(200);
    }

    // The transcript, the visitor's contact details, the visitor session, and
    // the notification record left with the conversation.
    expect((await sql<{ n: number }>("SELECT COUNT(*) AS n FROM conversations WHERE id = ?", expired.id)).n).toBe(0);
    expect((await sql<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?", expired.id)).n).toBe(0);
    expect((await sql<{ n: number }>("SELECT COUNT(*) AS n FROM visitor_sessions WHERE conversation_id = ?", expired.id)).n).toBe(0);
    expect((await sql<{ n: number }>("SELECT COUNT(*) AS n FROM return_tokens WHERE conversation_id = ?", expired.id)).n).toBe(0);
    expect((await sql<{ n: number }>("SELECT COUNT(*) AS n FROM notifications WHERE conversation_id = ?", expired.id)).n).toBe(0);

    // Accountability outlives the transcript: the staff actions survive with
    // their conversation link cleared, and the cleanup record carries counts
    // only — never message text or contact details.
    expect((await sql<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE conversation_id = ?", expired.id)).n).toBe(0);
    const detached = await sql<{ n: number }>(
      "SELECT COUNT(*) AS n FROM audit_log WHERE conversation_id IS NULL AND action = 'conversation_claimed'",
    );
    expect(detached.n).toBeGreaterThanOrEqual(1);

    const run = await sql<{ retention_days: number; removed_conversations: number; ran_at: string }>(
      "SELECT retention_days, removed_conversations, ran_at FROM retention_runs ORDER BY ran_at DESC LIMIT 1",
    );
    expect(run.retention_days).toBe(30);
    expect(run.removed_conversations).toBe(1);
  });
});

describe("the retention boundary is the configured period", () => {
  it("removes only past the period, keeps the boundary instant", async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { runRetentionSweep } = await import("../src/domain/retention");
    const { db, store } = await getChatbotService();

    // A fixed clock captured now, so the exact boundary (30 days before it)
    // can be set to the millisecond on both fixtures. Only this describe's
    // direct sweep call uses it; later tests sweep at real time.
    const now = new Date();
    const periodMs = 30 * 24 * 60 * 60 * 1000;
    const justBefore = await closedConversation();
    await setClosedAt(justBefore.id, new Date(now.getTime() - periodMs - 60_000).toISOString());
    const atBoundary = await closedConversation();
    await setClosedAt(atBoundary.id, new Date(now.getTime() - periodMs).toISOString());

    const result = await runRetentionSweep(db, store, now);
    expect(result?.removedConversations).toBe(1);
    expect((await sql<{ n: number }>("SELECT COUNT(*) AS n FROM conversations WHERE id = ?", justBefore.id)).n).toBe(0);
    // At exactly the boundary the period has not quite passed; the transcript
    // lasts one moment longer.
    expect((await sql<{ n: number }>("SELECT COUNT(*) AS n FROM conversations WHERE id = ?", atBoundary.id)).n).toBe(1);
  });

  it("does nothing while retention is unconfigured", async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { runRetentionSweep } = await import("../src/domain/retention");
    const { db, store } = await getChatbotService();

    db.prepare("DELETE FROM settings WHERE key = 'transcript_retention_days'").run();
    const oldClosed = await closedConversation();
    await setClosedAt(oldClosed.id, daysAgo(365));

    const before = await sql<{ n: number }>("SELECT COUNT(*) AS n FROM retention_runs");
    const result = await runRetentionSweep(db, store, new Date());
    expect(result).toBeNull();
    expect((await sql<{ n: number }>("SELECT COUNT(*) AS n FROM conversations WHERE id = ?", oldClosed.id)).n).toBe(1);
    expect((await sql<{ n: number }>("SELECT COUNT(*) AS n FROM retention_runs")).n).toBe(before.n);
  });
});

describe("a deleted conversation is unavailable everywhere", () => {
  it("cuts off the dashboard, the widget session, and return links", async () => {
    const gone = await closedConversation("departed@example.net");
    await setClosedAt(gone.id, daysAgo(40));

    // An unused, unexpired return link for the conversation, as delivery
    // would have minted (raw token exists only in the email).
    const { hashSessionToken } = await import("../src/domain/tokens");
    const rawToken = `return-${crypto.randomUUID()}`;
    const { db } = await (await import("../src/db/service")).getChatbotService();
    db.prepare(
      "INSERT INTO return_tokens (token_hash, conversation_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    ).run(hashSessionToken(rawToken), gone.id, daysAgo(1), new Date(Date.now() + 86_400_000).toISOString());

    const ownerJar = new CookieJar();
    await signInWithTotp(ownerJar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    const saved = await putRetention(ownerJar, 30);
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as { days: number; removed: number };
    expect(body.days).toBe(30);
    expect(body.removed).toBeGreaterThanOrEqual(1);

    const staffJar = new CookieJar();
    await signInWithTotp(staffJar, STAFF_EMAIL, STAFF_PASSWORD, staffTotp);
    expect((await staffDetail(staffJar, gone.id)).status).toBe(404);

    // The widget's stored credential no longer opens the conversation.
    expect((await loadHistory(gone)).status).toBe(404);
    expect((await ask(gone, "Are you still there?")).status).toBe(404);

    // The mailed link cannot reopen it either.
    const { POST } = await import("../src/app/api/v1/return/route");
    const redeem = await POST(
      new Request(`${TEST_ORIGIN}/api/v1/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: rawToken }),
      }),
    );
    expect(redeem.status).toBe(410);
  });
});

describe("cleanup is safe to rerun", () => {
  it("removes nothing on a second pass and records no duplicate result", async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { runRetentionSweep } = await import("../src/domain/retention");
    const { db, store } = await getChatbotService();

    const before = await sql<{ n: number }>("SELECT COUNT(*) AS n FROM retention_runs");
    const result = await runRetentionSweep(db, store, new Date());
    expect(result).not.toBeNull();
    expect(result?.removedConversations).toBe(0);
    expect((await sql<{ n: number }>("SELECT COUNT(*) AS n FROM retention_runs")).n).toBe(before.n);

    // And through the automated path: a second inbox load stays healthy.
    const staffJar = new CookieJar();
    await signInWithTotp(staffJar, STAFF_EMAIL, STAFF_PASSWORD, staffTotp);
    expect((await inboxGet(staffJar)).status).toBe(200);
    expect((await sql<{ n: number }>("SELECT COUNT(*) AS n FROM retention_runs")).n).toBe(before.n);
  });
});
