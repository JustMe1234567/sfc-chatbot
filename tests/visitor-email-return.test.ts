import { existsSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ask,
  loadHistory,
  loadHistoryAs,
  startConversation,
  confirmHandoffYes,
  TEST_ORIGIN,
  useTempDatabase,
  warmChatbotService,
  type ConversationStart,
  countQuery,
} from "./helpers";
import {
  CookieJar,
  enrollTotp,
  provisionStaff,
  signInWithTotp,
} from "./auth-helpers";
import { repoRoot } from "../src/paths";

/**
 * Ticket 66 retired the optional handoff-email request and the visitor
 * return-link email (ticket 07): email is captured with the required
 * contact details at chat start instead, and a staff reply simply waits in
 * the chat. Return links mailed before that change stay redeemable until
 * their normal expiry, so redemption is still covered here with links
 * minted the way the old delivery did.
 */

const STAFF_EMAIL = "alice@example.edu";
const STAFF_PASSWORD = "alice-return-harbor-61";

let staffTotp: Awaited<ReturnType<typeof enrollTotp>>;

async function count(postgresSql: string, sqliteSql: string, ...params: string[]): Promise<number> {
  const { getChatbotService } = await import("../src/db/service");
  const { db } = await getChatbotService();
  const row = (await db.get<{ n: number }>(countQuery(postgresSql, sqliteSql), ...params)) as {
    n: number;
  };
  return Number(row.n);
}

async function redeem(rawToken: string): Promise<Response> {
  const { POST } = await import("../src/app/api/v1/return/route");
  return POST(
    new Request(`${TEST_ORIGIN}/api/v1/return`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: rawToken }),
    }),
  );
}

async function staffClaimReply(conversationId: string, replyText: string): Promise<Response> {
  const jar = new CookieJar();
  await signInWithTotp(jar, STAFF_EMAIL, STAFF_PASSWORD, staffTotp);
  const claimRoute = await import("../src/app/api/staff/conversations/[id]/claim/route");
  await claimRoute.POST(
    new Request(`${TEST_ORIGIN}/api/staff/conversations/${conversationId}/claim`, {
      method: "POST",
      headers: { cookie: jar.header(), origin: TEST_ORIGIN },
    }),
    { params: Promise.resolve({ id: conversationId }) },
  );
  const replyRoute = await import("../src/app/api/staff/conversations/[id]/reply/route");
  return replyRoute.POST(
    new Request(`${TEST_ORIGIN}/api/staff/conversations/${conversationId}/reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: jar.header(),
        origin: TEST_ORIGIN,
      },
      body: JSON.stringify({ text: replyText }),
    }),
    { params: Promise.resolve({ id: conversationId }) },
  );
}

async function escalatedConversation(email: string): Promise<ConversationStart> {
  const conversation = await startConversation({ email });
  await ask(conversation, "Something no rule covers; I need to speak to a human.");
  await confirmHandoffYes(conversation);
  return conversation;
}

/** A return link as the pre-ticket delivery minted it: only the hash is
 *  stored, and the raw token existed solely inside the mailed link. */
async function issuedReturnLink(conversationId: string, expiresAt: string): Promise<string> {
  const { getChatbotService } = await import("../src/db/service");
  const { hashSessionToken } = await import("../src/domain/tokens");
  const { store } = await getChatbotService();
  const rawToken = `return-${crypto.randomUUID()}`;
  await store.createReturnToken({
    tokenHash: hashSessionToken(rawToken),
    conversationId,
    createdAt: new Date().toISOString(),
    expiresAt,
  });
  return rawToken;
}

function inOneDay(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await warmChatbotService();
  await provisionStaff({ email: STAFF_EMAIL, password: STAFF_PASSWORD, name: "Alice" });
  staffTotp = await enrollTotp(new CookieJar(), STAFF_EMAIL, STAFF_PASSWORD);
});

describe("the optional handoff email request is gone", () => {
  it("no longer ships a visitor email endpoint", () => {
    expect(
      existsSync(path.join(repoRoot(), "src/app/api/v1/conversations/[id]/email/route.ts")),
    ).toBe(false);
  });
});

describe("a staff reply never emails the visitor a return link", () => {
  it("sends nothing to the visitor, however long ago they were last seen", async () => {
    const conversation = await escalatedConversation("gone@example.org");
    // The visitor's last authorized request is pushed far into the past:
    // the departure that used to trigger the return-link email.
    const { getChatbotService } = await import("../src/db/service");
    const { db } = await getChatbotService();
    await db.run(
      "UPDATE conversations SET visitor_last_seen_at = ? WHERE id = ?",
      new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      conversation.id,
    );

    const reply = await staffClaimReply(conversation.id, "The deadline is next Friday.");
    expect(reply.status).toBe(200);

    expect(
      await count(
        "SELECT COUNT(*)::int AS n FROM mail_outbox WHERE to_address = ?",
        "SELECT COUNT(*) AS n FROM mail_outbox WHERE to_address = ?",
        "gone@example.org",
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*)::int AS n FROM notifications WHERE type = 'visitor_return'",
        "SELECT COUNT(*) AS n FROM notifications WHERE type = 'visitor_return'",
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*)::int AS n FROM return_tokens WHERE conversation_id = ?",
        "SELECT COUNT(*) AS n FROM return_tokens WHERE conversation_id = ?",
        conversation.id,
      ),
    ).toBe(0);

    // The reply itself is waiting in the chat.
    const history = await loadHistory(conversation);
    const body = (await history.json()) as { messages: { role: string; text: string }[] };
    expect(body.messages.at(-1)?.role).toBe("staff");
  });

  it("still sends the staff escalation alert exactly as before", async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { db } = await getChatbotService();
    const before = await count(
      "SELECT COUNT(*)::int AS n FROM notifications WHERE type = 'escalation_alert'",
      "SELECT COUNT(*) AS n FROM notifications WHERE type = 'escalation_alert'",
    );
    const conversation = await escalatedConversation("alerted@example.org");
    expect(
      await count(
        "SELECT COUNT(*)::int AS n FROM notifications WHERE type = 'escalation_alert'",
        "SELECT COUNT(*) AS n FROM notifications WHERE type = 'escalation_alert'",
      ),
    ).toBe(before + 1);
    const row = (await db.get<{ conversation_id: string }>(
      "SELECT conversation_id FROM notifications WHERE type = 'escalation_alert' AND conversation_id = ?",
      conversation.id,
    )) as { conversation_id: string };
    expect(row.conversation_id).toBe(conversation.id);
  });
});

describe("redeeming a previously issued return link", () => {
  it("restores exactly its own conversation and history", async () => {
    const conversation = await escalatedConversation("back@example.org");
    await staffClaimReply(conversation.id, "Here is your answer about courses.");
    const rawToken = await issuedReturnLink(conversation.id, inOneDay());

    const redemption = await redeem(rawToken);
    expect(redemption.status).toBe(200);
    const session = (await redemption.json()) as { id: string; token: string; expiresAt: string };
    expect(session.id).toBe(conversation.id);

    const history = await loadHistory({ id: conversation.id, token: session.token });
    expect(history.status).toBe(200);
    const body = (await history.json()) as { messages: { role: string; text: string }[] };
    expect(body.messages.at(-1)?.text).toContain("Here is your answer about courses.");

    // The restored credential reads only its own conversation.
    const other = await escalatedConversation("other@example.org");
    const crossing = await loadHistoryAs({ id: conversation.id, token: session.token }, other);
    expect(crossing.status).toBe(404);
  });

  it("rejects a used, expired, or unknown link", async () => {
    const conversation = await escalatedConversation("once@example.org");
    const rawToken = await issuedReturnLink(conversation.id, inOneDay());

    const first = await redeem(rawToken);
    expect(first.status).toBe(200);
    const replay = await redeem(rawToken);
    expect(replay.status).toBe(410);

    const unknown = await redeem("totally-unknown-token-value");
    expect(unknown.status).toBe(410);

    // A link that has aged past its normal expiry is refused even unused.
    const expiredToken = await issuedReturnLink(
      conversation.id,
      new Date(Date.now() - 1_000).toISOString(),
    );
    const expiredRedemption = await redeem(expiredToken);
    expect(expiredRedemption.status).toBe(410);
  });

  it("rejects malformed redemption requests", async () => {
    const missing = await redeem(undefined as unknown as string);
    expect(missing.status).toBe(400);
    const wrongType = await redeem(42 as unknown as string);
    expect(wrongType.status).toBe(400);
  });

  it("throttles redemption hammering", async () => {
    let throttled = 0;
    for (let i = 0; i < 22; i++) {
      const response = await redeem("hammering-attempt-token");
      if (response.status === 429) {
        throttled += 1;
      } else {
        expect(response.status).toBe(410);
      }
    }
    expect(throttled).toBeGreaterThanOrEqual(1);
  });
});
