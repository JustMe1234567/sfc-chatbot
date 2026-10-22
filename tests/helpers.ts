import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const TEST_ORIGIN = "http://chatbot.test";

/**
 * Points the app's database singleton at a fresh temporary SQLite file.
 * Call once per test file in beforeAll, before any route handler runs:
 * each vitest file has its own module registry, so the singleton and its
 * in-process rate limiters start clean.
 */
export function useTempDatabase(): string {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "sfc-chatbot-test-")), "test.db");
  process.env.CHATBOT_DB = dbPath;
  return dbPath;
}

export interface ConversationStart {
  id: string;
  token: string;
}

export async function startConversation(): Promise<ConversationStart> {
  const { POST } = await import("../src/app/api/v1/conversations/route");
  const response = await POST(
    new Request(`${TEST_ORIGIN}/api/v1/conversations`, { method: "POST" }),
  );
  if (!response.ok) {
    throw new Error(`conversation start failed: ${response.status}`);
  }
  return (await response.json()) as ConversationStart;
}

function messagesUrl(conversation: ConversationStart): string {
  return `${TEST_ORIGIN}/api/v1/conversations/${conversation.id}/messages`;
}

export async function ask(conversation: ConversationStart, text: string): Promise<Response> {
  return askRaw(conversation, JSON.stringify({ text }));
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
