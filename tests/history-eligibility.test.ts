import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadHistory, startConversation, TEST_ORIGIN, useTempDatabase, warmChatbotService } from "./helpers";
import { CookieJar, enrollTotp, provisionStaff, signInWithTotp } from "./auth-helpers";
import { repoRoot } from "../src/paths";

/**
 * Ticket 62: History membership is the deletion boundary. Every History
 * conversation — closed, or quiet past the 24-hour inactivity window in any
 * stored state — can be deleted after confirmation, cleared by an owner,
 * and expired by the transcript-retention period counted from the moment
 * it entered History. Eligibility is rechecked inside the store's atomic
 * purge, so a conversation that turned live between listing and deletion
 * survives with every related record untouched, on SQLite and Postgres
 * alike (this file runs on Postgres under CHATBOT_TEST_POSTGRES_URL).
 */

const OWNER_EMAIL = "owner@example.edu";
const OWNER_PASSWORD = "owner-eligible-harbor-6q";
const STAFF_EMAIL = "helper@example.edu";
const STAFF_PASSWORD = "helper-eligible-willow-3z";
const DAY_MS = 24 * 60 * 60 * 1000;

type StoredState = "bot_active" | "awaiting_staff" | "claimed" | "closed";
const ALL_STATES: StoredState[] = ["bot_active", "awaiting_staff", "claimed", "closed"];

let ownerTotp: Awaited<ReturnType<typeof enrollTotp>>;
let staffTotp: Awaited<ReturnType<typeof enrollTotp>>;
let staffUserId: string;

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await warmChatbotService();
  await provisionStaff({ email: OWNER_EMAIL, password: OWNER_PASSWORD, name: "Olive", role: "owner" });
  await provisionStaff({ email: STAFF_EMAIL, password: STAFF_PASSWORD, name: "Sam" });
  ownerTotp = await enrollTotp(new CookieJar(), OWNER_EMAIL, OWNER_PASSWORD);
  staffTotp = await enrollTotp(new CookieJar(), STAFF_EMAIL, STAFF_PASSWORD);
  const { getChatbotService } = await import("../src/db/service");
  const { db } = await getChatbotService();
  staffUserId = (await db.get<{ id: string }>('SELECT id FROM staff_members WHERE email = ?', STAFF_EMAIL))!.id;
});

async function service() {
  const { getChatbotService } = await import("../src/db/service");
  return getChatbotService();
}

/**
 * One conversation with every record a purge must remove (transcript,
 * visitor session, return link, notification) plus an audit row it must
 * detach. `lastActivityAt` is the inactivity clock; closed rows also carry
 * `closedAt`.
 */
async function seed(
  state: StoredState,
  opts: { lastActivityAt: string; closedAt?: string },
): Promise<string> {
  const { db } = await service();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.run(
    "INSERT INTO conversations (id, state, created_at, last_activity_at, closed_at) VALUES (?, ?, ?, ?, ?)",
    id,
    state,
    opts.lastActivityAt,
    opts.lastActivityAt,
    state === "closed" ? (opts.closedAt ?? opts.lastActivityAt) : null,
  );
  await db.run(
    "INSERT INTO messages (id, conversation_id, role, text, created_at) VALUES (?, ?, 'visitor', 'Please help me', ?)",
    crypto.randomUUID(),
    id,
    opts.lastActivityAt,
  );
  await db.run(
    "INSERT INTO visitor_sessions (token_hash, conversation_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    `hash-${id}`,
    id,
    now,
    new Date(Date.now() + 3_600_000).toISOString(),
  );
  await db.run(
    "INSERT INTO return_tokens (token_hash, conversation_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    `return-${id}`,
    id,
    now,
    new Date(Date.now() + 3_600_000).toISOString(),
  );
  await db.run(
    "INSERT INTO notifications (id, type, conversation_id, recipients, status, created_at) VALUES (?, 'escalation', ?, '[]', 'sent', ?)",
    crypto.randomUUID(),
    id,
    now,
  );
  await db.run(
    "INSERT INTO audit_log (id, conversation_id, actor_id, action, created_at) VALUES (?, ?, ?, 'conversation_claimed', ?)",
    `audit-${id}`,
    id,
    staffUserId,
    now,
  );
  return id;
}

/** Counts of every record that belongs to the conversation. */
async function footprint(id: string): Promise<Record<string, number>> {
  const { db } = await service();
  const count = async (table: string) =>
    Number(
      (await db.get<{ n: number | string }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${table === "conversations" ? "id" : "conversation_id"} = ?`, id))
        ?.n ?? 0,
    );
  return {
    conversations: await count("conversations"),
    messages: await count("messages"),
    visitor_sessions: await count("visitor_sessions"),
    return_tokens: await count("return_tokens"),
    notifications: await count("notifications"),
    audit_linked: await count("audit_log"),
  };
}

const INTACT = {
  conversations: 1,
  messages: 1,
  visitor_sessions: 1,
  return_tokens: 1,
  notifications: 1,
  audit_linked: 1,
};
const GONE = {
  conversations: 0,
  messages: 0,
  visitor_sessions: 0,
  return_tokens: 0,
  notifications: 0,
  audit_linked: 0,
};

async function auditSurvives(id: string): Promise<boolean> {
  const { db } = await service();
  const row = await db.get<{ conversation_id: string | null }>(
    "SELECT conversation_id FROM audit_log WHERE id = ?",
    `audit-${id}`,
  );
  return row !== undefined && row.conversation_id === null;
}

function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

async function staffJar(): Promise<CookieJar> {
  const jar = new CookieJar();
  await signInWithTotp(jar, STAFF_EMAIL, STAFF_PASSWORD, staffTotp);
  return jar;
}

async function ownerJar(): Promise<CookieJar> {
  const jar = new CookieJar();
  await signInWithTotp(jar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
  return jar;
}

async function deleteRequest(jar: CookieJar | null, id: string): Promise<Response> {
  const { POST } = await import("../src/app/api/staff/conversations/[id]/delete/route");
  return POST(
    new Request(`${TEST_ORIGIN}/api/staff/conversations/${id}/delete`, {
      method: "POST",
      headers: { ...(jar ? { cookie: jar.header() } : {}), origin: TEST_ORIGIN },
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function clearRequest(jar: CookieJar | null): Promise<Response> {
  const { POST } = await import("../src/app/api/staff/conversations/clear-history/route");
  return POST(
    new Request(`${TEST_ORIGIN}/api/staff/conversations/clear-history`, {
      method: "POST",
      headers: { ...(jar ? { cookie: jar.header() } : {}), origin: TEST_ORIGIN },
    }),
  );
}

describe("the shared History rule (ticket 62)", () => {
  it("dates History entry from closure, or from the end of the quiet window", async () => {
    const { historyEnteredAt } = await import("../src/domain/activity");
    const now = new Date("2026-11-07T12:00:00.000Z");
    const base = {
      id: "c",
      createdAt: "2026-10-01T00:00:00.000Z",
      claimedBy: null,
      claimedAt: null,
      visitorName: null,
      visitorEmail: null,
      visitorPhone: null,
      visitorLastSeenAt: null,
      attentionAt: null,
      replacedBy: null,
    };
    // Closed: History begins at closure, however recent its messages.
    expect(
      historyEnteredAt(
        { ...base, state: "closed", closedAt: "2026-11-07T11:00:00.000Z", lastActivityAt: "2026-11-07T11:00:00.000Z" },
        now,
      ),
    ).toBe("2026-11-07T11:00:00.000Z");
    for (const state of ["bot_active", "awaiting_staff", "claimed"] as const) {
      // Exactly 24 hours of quiet: still live for one more moment.
      expect(
        historyEnteredAt({ ...base, state, closedAt: null, lastActivityAt: "2026-11-06T12:00:00.000Z" }, now),
        state,
      ).toBeNull();
      // One millisecond past the window: in History since the window ended.
      expect(
        historyEnteredAt({ ...base, state, closedAt: null, lastActivityAt: "2026-11-06T11:59:59.999Z" }, now),
        state,
      ).toBe("2026-11-07T11:59:59.999Z");
    }
  });
});

describe("the atomic History purge (ticket 62)", () => {
  it("removes every record of a History conversation in all four stored states", async () => {
    const { store } = await service();
    const { historyQuietBefore } = await import("../src/domain/activity");
    for (const state of ALL_STATES) {
      const id = await seed(state, { lastActivityAt: ago(2 * DAY_MS) });
      expect(await store.purgeHistoryConversation(id, historyQuietBefore(new Date())), state).toBe(true);
      expect(await footprint(id), state).toEqual(GONE);
      // Accountability outlives the transcript, detached as before.
      expect(await auditSurvives(id), state).toBe(true);
    }
  });

  it("refuses a live conversation and leaves every related record untouched", async () => {
    const { store } = await service();
    const { historyQuietBefore } = await import("../src/domain/activity");
    for (const state of ["bot_active", "awaiting_staff", "claimed"] as const) {
      const id = await seed(state, { lastActivityAt: ago(60_000) });
      expect(await store.purgeHistoryConversation(id, historyQuietBefore(new Date())), state).toBe(false);
      // No partial delete: the refused purge removed nothing at all.
      expect(await footprint(id), state).toEqual(INTACT);
    }
    expect(await store.purgeHistoryConversation(crypto.randomUUID(), historyQuietBefore(new Date()))).toBe(false);
  });

  it("rechecks at purge time: a row that turned live after listing survives", async () => {
    const { store } = await service();
    const { historyQuietBefore } = await import("../src/domain/activity");
    const id = await seed("claimed", { lastActivityAt: ago(2 * DAY_MS) });
    // The visitor writes again between the list render and the purge.
    await store.touchConversationActivity(id, new Date().toISOString(), new Date(Date.now() + DAY_MS).toISOString());
    expect(await store.purgeHistoryConversation(id, historyQuietBefore(new Date()))).toBe(false);
    expect(await footprint(id)).toEqual(INTACT);
  });
});

describe("POST /api/staff/conversations/[id]/delete for every History row (ticket 62)", () => {
  it("lets any staff member delete a quiet row in each non-closed state", async () => {
    const jar = await staffJar();
    for (const state of ["bot_active", "awaiting_staff", "claimed"] as const) {
      const id = await seed(state, { lastActivityAt: ago(2 * DAY_MS) });
      const response = await deleteRequest(jar, id);
      expect(response.status, state).toBe(200);
      expect(await footprint(id), state).toEqual(GONE);
    }
  });

  it("rejects a live conversation with a clear conflict and removes nothing", async () => {
    const jar = await staffJar();
    const id = await seed("awaiting_staff", { lastActivityAt: ago(60_000) });
    const response = await deleteRequest(jar, id);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe("conversation_live");
    expect(body.error?.message).toMatch(/live/i);
    expect(await footprint(id)).toEqual(INTACT);
  });

  it("keeps unknown ids at 404 and unauthenticated callers at 401", async () => {
    const jar = await staffJar();
    expect((await deleteRequest(jar, crypto.randomUUID())).status).toBe(404);
    const id = await seed("claimed", { lastActivityAt: ago(2 * DAY_MS) });
    expect((await deleteRequest(null, id)).status).toBe(401);
    expect(await footprint(id)).toEqual(INTACT);
  });

  it("gives the visitor the same fresh-chat path as a retention purge", async () => {
    const visitor = await startConversation();
    const { db } = await service();
    await db.run("UPDATE conversations SET last_activity_at = ? WHERE id = ?", ago(2 * DAY_MS), visitor.id);
    expect((await deleteRequest(await staffJar(), visitor.id)).status).toBe(200);
    // The stale credential no longer opens anything; the widget starts over.
    expect([401, 404]).toContain((await loadHistory(visitor)).status);
  });
});

describe("owner Clear history covers all History rows (ticket 62)", () => {
  it("is owner-only", async () => {
    expect((await clearRequest(null)).status).toBe(401);
    expect((await clearRequest(await staffJar())).status).toBe(403);
  });

  it("removes closed and quiet rows of every state, keeps live ones", async () => {
    const history = [];
    for (const state of ALL_STATES) {
      history.push(await seed(state, { lastActivityAt: ago(2 * DAY_MS) }));
    }
    const live = [];
    for (const state of ["bot_active", "awaiting_staff", "claimed"] as const) {
      live.push(await seed(state, { lastActivityAt: ago(60_000) }));
    }
    const response = await clearRequest(await ownerJar());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { removed: number };
    expect(body.removed).toBeGreaterThanOrEqual(history.length);
    for (const id of history) {
      expect(await footprint(id)).toEqual(GONE);
    }
    for (const id of live) {
      expect(await footprint(id)).toEqual(INTACT);
    }
  });
});

describe("retention expires History rows from the moment they entered it (ticket 62)", () => {
  it("counts quiet rows from the end of their window and closed rows from closure", async () => {
    const { db, store } = await service();
    const { runRetentionSweep } = await import("../src/domain/retention");
    const { setTranscriptRetentionDays } = await import("../src/settings");
    await setTranscriptRetentionDays(db, null); // the 30-day default
    const now = new Date();
    const period = 30 * DAY_MS;
    // Quiet rows entered History at lastActivity + 24h; the boundary instant
    // itself survives, one minute past it expires.
    const quietExpired = await seed("claimed", { lastActivityAt: new Date(now.getTime() - period - DAY_MS - 60_000).toISOString() });
    const quietAtBoundary = await seed("bot_active", { lastActivityAt: new Date(now.getTime() - period - DAY_MS).toISOString() });
    // 30 days since last activity is only 29 days in History: kept.
    const quietYoung = await seed("awaiting_staff", { lastActivityAt: new Date(now.getTime() - period - 60_000).toISOString() });
    // Closed rows still read closedAt, not their activity.
    const closedExpired = await seed("closed", {
      lastActivityAt: new Date(now.getTime() - period - 2 * DAY_MS).toISOString(),
      closedAt: new Date(now.getTime() - period - 60_000).toISOString(),
    });
    const closedRecent = await seed("closed", {
      lastActivityAt: new Date(now.getTime() - 40 * DAY_MS).toISOString(),
      closedAt: new Date(now.getTime() - period + 60_000).toISOString(),
    });
    // A live conversation of any age survives.
    const ancientButLive = await seed("claimed", { lastActivityAt: new Date(now.getTime() - 60_000).toISOString() });
    await db.run("UPDATE conversations SET created_at = ? WHERE id = ?", new Date(now.getTime() - 400 * DAY_MS).toISOString(), ancientButLive);

    await runRetentionSweep(db, store, now);
    expect(await footprint(quietExpired)).toEqual(GONE);
    expect(await auditSurvives(quietExpired)).toBe(true);
    expect(await footprint(closedExpired)).toEqual(GONE);
    for (const id of [quietAtBoundary, quietYoung, closedRecent, ancientButLive]) {
      expect(await footprint(id)).toEqual(INTACT);
    }
  });

  it("lets the owner's period override the default", async () => {
    const { db, store } = await service();
    const { runRetentionSweep } = await import("../src/domain/retention");
    const { setTranscriptRetentionDays } = await import("../src/settings");
    await setTranscriptRetentionDays(db, 5);
    const now = new Date();
    const expired = await seed("awaiting_staff", { lastActivityAt: new Date(now.getTime() - 6 * DAY_MS - 60_000).toISOString() });
    const kept = await seed("awaiting_staff", { lastActivityAt: new Date(now.getTime() - 6 * DAY_MS + 60_000).toISOString() });
    await runRetentionSweep(db, store, now);
    expect(await footprint(expired)).toEqual(GONE);
    expect(await footprint(kept)).toEqual(INTACT);
    await setTranscriptRetentionDays(db, null);
  });
});

describe("the History controls and wording (ticket 62)", () => {
  async function read(rel: string): Promise<string> {
    return readFile(path.join(repoRoot(), rel), "utf8");
  }

  it("offers Delete on every History row and none on live rows", async () => {
    const entry = await read("src/app/dashboard/inbox/desk-entry.tsx");
    expect(entry).toContain("const deletable = !item.active;");
    expect(entry).not.toContain('item.state === "closed"');
  });

  it("counts all History rows for the owner's Clear history", async () => {
    const desk = await read("src/app/dashboard/inbox/conversation-desk.tsx");
    expect(desk).toContain('guard.staff.role === "owner" && history.length > 0');
    expect(desk).toContain("<ClearHistoryButton count={history.length}");
    expect(desk).not.toContain("closedHistoryCount");
  });

  it("explains that inactive History conversations are removable too", async () => {
    const actions = await read("src/app/dashboard/inbox/history-actions.tsx");
    const retention = await read("src/app/dashboard/notifications/retention-form.tsx");
    const settingsPage = await read("src/app/dashboard/notifications/page.tsx");
    expect(actions).not.toMatch(/removes \{count\} closed conversation/);
    expect(actions).toMatch(/closed or inactive/);
    expect(retention).not.toContain("Closed conversations are removed permanently");
    expect(retention).toMatch(/closed or inactive/);
    expect(settingsPage).not.toContain("how long closed");
  });
});
