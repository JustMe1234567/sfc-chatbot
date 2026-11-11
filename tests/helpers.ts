import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const TEST_ORIGIN = "http://chatbot.test";

/**
 * The Postgres backend for the whole suite (ticket 11): set
 * CHATBOT_TEST_POSTGRES_URL to a Postgres URL whose database acts as the
 * administrative handle (databases get created on its server), and every
 * test file runs the complete flow suite against its own freshly-migrated
 * Postgres database instead of SQLite. Without it the suite runs on SQLite.
 */
export function testPostgresUrl(): string | null {
  const url = process.env.CHATBOT_TEST_POSTGRES_URL;
  return url && url.trim().length > 0 ? url.trim() : null;
}

let postgresDbName: string | null = null;

/**
 * Points the app's database singleton at a fresh temporary store. Call once
 * per test file in beforeAll, before any route handler runs: each vitest
 * file has its own module registry, so the singleton and its in-process
 * rate limiters start clean.
 *
 * SQLite mode creates a temp file; Postgres mode creates a uniquely-named
 * database on the CHATBOT_TEST_POSTGRES_URL server (dropping any leftover of
 * the same name first — names are random per run, so this only reaps debris
 * from a crashed run of this very file). The database is left behind for the
 * retention/restart checks to inspect and dropped by the next run of the
 * same file name; drop it manually or let the server's own maintenance clear
 * test databases.
 */
export function useTempDatabase(): string {
  const postgresUrl = testPostgresUrl();
  if (postgresUrl) {
    if (!postgresDbName) {
      // Synchronous env setup: vitest files need the name decided inside
      // beforeAll, and CREATE DATABASE itself is awaited in warmChatbotService.
      postgresDbName = `sfc_test_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    }
    process.env.CHATBOT_TEST_PG_DBNAME = postgresDbName;
    // Swap the admin URL's database segment (a single path segment such as
    // /postgres) for the per-file database; query strings survive.
    process.env.DATABASE_URL = postgresUrl.replace(/\/[^/?]+(\?|$)/, `/${postgresDbName}$1`);
    return process.env.DATABASE_URL;
  }
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "sfc-chatbot-test-")), "test.db");
  process.env.CHATBOT_DB = dbPath;
  return dbPath;
}

/**
 * Postgres mode: creates the per-file database (dropping any leftover) before
 * the service singleton migrates it. No-op on SQLite. Called from
 * warmChatbotService so every file gets it for free.
 */
export async function provisionTestDatabase(): Promise<void> {
  const adminUrl = testPostgresUrl();
  const dbName = process.env.CHATBOT_TEST_PG_DBNAME;
  if (!adminUrl || !dbName) {
    return;
  }
  const { withPostgres } = await import("../src/db/postgres");
  await withPostgres(adminUrl, async (sql) => {
    // WITH (FORCE) disconnects any straggler from a crashed earlier run.
    await sql.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await sql.unsafe(`CREATE DATABASE ${dbName}`);
  });
}

/**
 * A portable `SELECT COUNT(*) ...` assertion query: Postgres hands bigint
 * counts back as strings, so the count is cast to int there while SQLite
 * keeps the plain form. Only for tests — the application never reads counts
 * through this surface.
 */
export function countQuery(postgresSql: string, sqliteSql: string): string {
  return testPostgresUrl() ? postgresSql : sqliteSql;
}

/**
 * Builds the app service (migrations, seed, auth) inside beforeAll's 10s
 * hook budget instead of the first test's 5s: under a full parallel suite
 * run, cold init can outgrow a single test's timeout even though the suite
 * itself is fine. Staff files get this for free by provisioning accounts.
 * Postgres mode provisions and migrates the per-file database here too.
 */
export async function warmChatbotService(): Promise<void> {
  await provisionTestDatabase();
  const { getChatbotService } = await import("../src/db/service");
  await getChatbotService();
}

export interface ConversationStart {
  id: string;
  token: string;
}

/** Valid contact details for the chat-start gate (ticket 66). */
export const TEST_CONTACT = {
  fullName: "Jane Doe",
  email: "jane.doe@example.org",
  phone: "+1 (555) 010-0199",
};

/** POSTs the create route with the given body: the gate's raw surface. */
export async function startConversationRaw(body: unknown): Promise<Response> {
  const { POST } = await import("../src/app/api/v1/conversations/route");
  return POST(
    new Request(`${TEST_ORIGIN}/api/v1/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

/** Starts a chat the way the widget does: with accepted contact details. */
export async function startConversation(
  contact: Partial<typeof TEST_CONTACT> = {},
): Promise<ConversationStart> {
  const response = await startConversationRaw({ ...TEST_CONTACT, ...contact });
  if (!response.ok) {
    throw new Error(`conversation start failed: ${response.status}`);
  }
  return (await response.json()) as ConversationStart;
}

/** Submits contact details to an existing conversation: the unlock path. */
export async function submitContact(
  conversation: ConversationStart,
  contact: unknown = TEST_CONTACT,
): Promise<Response> {
  const { POST } = await import("../src/app/api/v1/conversations/[id]/contact/route");
  return POST(
    new Request(`${TEST_ORIGIN}/api/v1/conversations/${conversation.id}/contact`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${conversation.token}`,
      },
      body: JSON.stringify(contact),
    }),
    { params: Promise.resolve({ id: conversation.id }) },
  );
}

function messagesUrl(conversation: ConversationStart): string {
  return `${TEST_ORIGIN}/api/v1/conversations/${conversation.id}/messages`;
}

export async function ask(conversation: ConversationStart, text: string): Promise<Response> {
  return askRaw(conversation, JSON.stringify({ text }));
}

/**
 * Confirms the persisted handoff prompt with "Yes, chat with staff"
 * (ticket 69): a typed handoff phrase no longer escalates on its own, so
 * flow tests that need the waiting state pick the prompt's Yes choice. The
 * phrase must have been asked first so the prompt is the last message.
 */
export async function confirmHandoffYes(conversation: ConversationStart): Promise<Response> {
  return askRaw(conversation, JSON.stringify({ choice: "handoff-yes" }));
}

export async function askRaw(conversation: ConversationStart, body: string): Promise<Response> {
  const { POST } = await import("../src/app/api/v1/conversations/[id]/messages/route");
  return POST(
    new Request(messagesUrl(conversation), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${conversation.token}`,
      },
      body,
    }),
    { params: Promise.resolve({ id: conversation.id }) },
  );
}

export async function loadHistory(conversation: ConversationStart): Promise<Response> {
  const { GET } = await import("../src/app/api/v1/conversations/[id]/messages/route");
  return GET(
    new Request(messagesUrl(conversation), {
      headers: { Authorization: `Bearer ${conversation.token}` },
    }),
    { params: Promise.resolve({ id: conversation.id }) },
  );
}

export async function fetchHistoryWithoutToken(
  conversation: ConversationStart,
): Promise<Response> {
  const { GET } = await import("../src/app/api/v1/conversations/[id]/messages/route");
  return GET(new Request(messagesUrl(conversation)), {
    params: Promise.resolve({ id: conversation.id }),
  });
}

/** Reads target's history using viewer's credential: cross-visitor isolation checks. */
export async function loadHistoryAs(
  viewer: ConversationStart,
  target: ConversationStart,
): Promise<Response> {
  const { GET } = await import("../src/app/api/v1/conversations/[id]/messages/route");
  return GET(
    new Request(messagesUrl(target), {
      headers: { Authorization: `Bearer ${viewer.token}` },
    }),
    { params: Promise.resolve({ id: target.id }) },
  );
}
