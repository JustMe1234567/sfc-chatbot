import { beforeAll, describe, expect, it } from "vitest";
import { ask, confirmHandoffYes, loadHistory, startConversation, submitContact, testPostgresUrl, TEST_ORIGIN, useTempDatabase, warmChatbotService, type ConversationStart } from "./helpers";
import {
  CookieJar,
  provisionStaff,
  signInAs,
} from "./auth-helpers";

const STAFF_EMAIL = "clear-desk@example.edu";
const STAFF_PASSWORD = "clear-desk-anchor-7w";

interface ClearResponse {
  id: string;
  token: string;
  expiresAt: string;
}

async function clearConversation(conversation: ConversationStart): Promise<Response> {
  const { POST } = await import("../src/app/api/v1/conversations/[id]/clear/route");
  return POST(
    new Request(`${TEST_ORIGIN}/api/v1/conversations/${conversation.id}/clear`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${conversation.token}`,
      },
    }),
    { params: Promise.resolve({ id: conversation.id }) },
  );
}

async function staffAction(
  jar: CookieJar,
  conversationId: string,
  action: "claim" | "reply",
  body?: unknown,
): Promise<Response> {
  const route = await import(`../src/app/api/staff/conversations/[id]/${action}/route`);
  return route.POST(
    new Request(`${TEST_ORIGIN}/api/staff/conversations/${conversationId}/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: jar.header(),
        origin: TEST_ORIGIN,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    { params: Promise.resolve({ id: conversationId }) },
  );
}

async function sql<T>(query: string, ...params: (string | number)[]): Promise<T> {
  const { getChatbotService } = await import("../src/db/service");
  const { db } = await getChatbotService();
  // Postgres returns bigint counts as strings; cast so assertions see numbers.
  const query_ = testPostgresUrl() ? query.split("COUNT(*)").join("COUNT(*)::int") : query;
  return (await db.get<T>(query_, ...params)) as T;
}

async function staffJar(): Promise<CookieJar> {
  const jar = new CookieJar();
  await signInAs(jar, STAFF_EMAIL, STAFF_PASSWORD);
  return jar;
}

async function escalatedConversation(text: string): Promise<ConversationStart> {
  const conversation = await startConversation();
  await ask(conversation, `${text} Please speak to a human.`);
  // The phrase asks first (ticket 69); Yes enters the waiting state.
  await confirmHandoffYes(conversation);
  return conversation;
}

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await warmChatbotService();
  await provisionStaff({ email: STAFF_EMAIL, password: STAFF_PASSWORD, name: "Skye" });
});

describe("clearing a bot-active conversation", () => {
  it("starts one fresh conversation and revokes the old credential", async () => {
    const old = await startConversation();
    await ask(old, "How do I apply?");

    const response = await clearConversation(old);
    expect(response.status).toBe(200);
    const fresh = (await response.json()) as ClearResponse;
    expect(fresh.id).not.toBe(old.id);
    expect(fresh.token).toBeTruthy();
    expect(fresh.expiresAt).toBeTruthy();

    // The fresh conversation is a distinct chat that requires the contact
    // form again (ticket 66): nothing is accepted until details are.
    const locked = await ask({ id: fresh.id, token: fresh.token }, "And what about the fees?");
    expect(locked.status).toBe(409);
    expect(((await locked.json()) as { error: { code: string } }).error.code).toBe("contact_required");
    expect((await submitContact({ id: fresh.id, token: fresh.token })).status).toBe(200);
    const freshAsk = await ask({ id: fresh.id, token: fresh.token }, "And what about the fees?");
    expect(freshAsk.status).toBe(200);

    // The old credential can neither read nor post to the old transcript.
    expect((await loadHistory(old)).status).toBe(404);
    expect((await ask(old, "Hello?")).status).toBe(404);
    // The fresh credential never unlocks the old conversation either.
    const { loadHistoryAs } = await import("./helpers");
    expect((await loadHistoryAs({ id: fresh.id, token: fresh.token }, old)).status).toBe(404);

    // The transcript is preserved for staff, plus the closing notice.
    expect(
      (await sql<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?", old.id)).n,
    ).toBe(3);
    expect((await sql<{ state: string; closed_at: string | null; replaced_by: string }>(
      "SELECT state, closed_at, replaced_by FROM conversations WHERE id = ?",
      old.id,
    )).state).toBe("closed");
    expect((await sql<{ replaced_by: string }>("SELECT replaced_by FROM conversations WHERE id = ?", old.id)).replaced_by).toBe(fresh.id);
    expect((await sql<{ closed_at: string | null }>("SELECT closed_at FROM conversations WHERE id = ?", old.id)).closed_at).not.toBeNull();
  });

  it("rejects unused return links for the cleared conversation", async () => {
    const old = await startConversation();
    await ask(old, "Desk seed: cleared with a return link, nothing covers this.");
    // An unused, unexpired return link, as delivery would have minted.
    const { hashSessionToken } = await import("../src/domain/tokens");
    const rawToken = `return-${crypto.randomUUID()}`;
    await sql(
      "INSERT INTO return_tokens (token_hash, conversation_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
      hashSessionToken(rawToken),
      old.id,
      new Date().toISOString(),
      new Date(Date.now() + 3_600_000).toISOString(),
    );

    const response = await clearConversation(old);
    expect(response.status).toBe(200);

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

describe("clearing after escalation and while claimed", () => {
  it("closes an escalated conversation into History without creating mail records", async () => {
    const old = await escalatedConversation("Clear test: escalated then cleared, nothing covers this.");

    const response = await clearConversation(old);
    expect(response.status).toBe(200);
    const fresh = (await response.json()) as ClearResponse;

    // Staff history keeps the transcript; sound-only attention creates no delivery record.
    expect(
      (await sql<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?", old.id)).n,
    ).toBeGreaterThanOrEqual(2);
    expect(
      (await sql<{ n: number }>("SELECT COUNT(*) AS n FROM notifications WHERE conversation_id = ?", old.id)).n,
    ).toBe(0);

    // The desk's History lists it; the Active lists do not.
    const jar = await staffJar();
    const { GET } = await import("../src/app/api/staff/conversations/route");
    const history = (await (
      await GET(
        new Request(`${TEST_ORIGIN}/api/staff/conversations?view=history`, { headers: { cookie: jar.header() } }),
      )
    ).json()) as { conversations: { id: string; state: string }[] };
    expect(history.conversations.some((item) => item.id === old.id && item.state === "closed")).toBe(true);

    const desk = (await (
      await GET(
        new Request(`${TEST_ORIGIN}/api/staff/conversations`, { headers: { cookie: jar.header() } }),
      )
    ).json()) as { incoming: { id: string }[]; active: { id: string }[] };
    expect(desk.incoming.some((item) => item.id === old.id)).toBe(false);
    // The fresh successor has no visitor-authored message yet, so the desk
    // omits it (ticket 73) — no blank `Visitor · bot` row.
    expect(desk.active.some((item) => item.id === fresh.id)).toBe(false);
    // The successor's first visitor question makes it a real chat: the
    // ordinary poll surfaces it on the active desk. The fresh chat's contact
    // columns start empty, so the visitor re-accepts the gate first.
    expect((await submitContact({ id: fresh.id, token: fresh.token })).status).toBe(200);
    expect((await ask({ id: fresh.id, token: fresh.token }, "Clear test: a real question this time.")).status).toBe(200);
    const deskAfter = (await (
      await GET(
        new Request(`${TEST_ORIGIN}/api/staff/conversations`, { headers: { cookie: jar.header() } }),
      )
    ).json()) as { active: { id: string }[] };
    expect(deskAfter.active.some((item) => item.id === fresh.id)).toBe(true);
  });

  it("ends a claimed conversation and stops further staff replies", async () => {
    const old = await escalatedConversation("Clear test: claimed then cleared by the visitor.");
    const jar = await staffJar();
    expect((await staffAction(jar, old.id, "claim")).status).toBe(200);

    const response = await clearConversation(old);
    expect(response.status).toBe(200);
    const fresh = (await response.json()) as ClearResponse;

    // Staff cannot reply to or re-claim the cleared conversation.
    const reply = await staffAction(jar, old.id, "reply", { text: "Anyone still here?" });
    expect(reply.status).toBe(409);
    const reclaim = await staffAction(jar, old.id, "claim");
    expect(reclaim.status).toBe(409);

    // The claimed conversation has left the active desk, and the fresh
    // successor is omitted until its first visitor question (ticket 73).
    const { GET: deskGet } = await import("../src/app/api/staff/conversations/route");
    const desk = (await (
      await deskGet(
        new Request(`${TEST_ORIGIN}/api/staff/conversations`, { headers: { cookie: jar.header() } }),
      )
    ).json()) as { active: { id: string }[] };
    expect(desk.active.some((item) => item.id === old.id)).toBe(false);
    expect(desk.active.some((item) => item.id === fresh.id)).toBe(false);

    expect((await submitContact({ id: fresh.id, token: fresh.token })).status).toBe(200);
    const freshAsk = await ask({ id: fresh.id, token: fresh.token }, "Clear test: starting over; speak to a human.");
    expect(freshAsk.status).toBe(200);
    // The first visitor question makes the successor visible on the desk.
    const deskAfter = (await (
      await deskGet(
        new Request(`${TEST_ORIGIN}/api/staff/conversations`, { headers: { cookie: jar.header() } }),
      )
    ).json()) as { active: { id: string }[] };
    expect(deskAfter.active.some((item) => item.id === fresh.id)).toBe(true);
    // The phrase asks first now (ticket 69); Yes puts the successor waiting.
    await confirmHandoffYes({ id: fresh.id, token: fresh.token });
    // And staff can work the successor: claim it.
    expect((await staffAction(jar, fresh.id, "claim")).status).toBe(200);
  });
});

describe("repeated and racing clears", () => {
  it("returns the same successor conversation to concurrent double clicks", async () => {
    const old = await escalatedConversation("Clear test: duplicate clicks, nothing covers this.");

    // The real double click: both requests authenticate with the still-live
    // credential; the store transaction serializes them.
    const [first, second] = await Promise.all([clearConversation(old), clearConversation(old)]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = (await first.json()) as ClearResponse;
    const secondBody = (await second.json()) as ClearResponse;
    expect(secondBody.id).toBe(firstBody.id);

    expect(
      (await sql<{ n: number }>("SELECT COUNT(*) AS n FROM conversations WHERE replaced_by = ?", firstBody.id)).n,
    ).toBe(1);
    // Both issued credentials open the same successor.
    expect((await loadHistory({ id: firstBody.id, token: firstBody.token })).status).toBe(200);
    expect((await loadHistory({ id: secondBody.id, token: secondBody.token })).status).toBe(200);
  });

  it("answers a later retry with the dead credential 404, leaving the successor alone", async () => {
    const old = await escalatedConversation("Clear test: late retry, nothing covers this.");
    expect((await clearConversation(old)).status).toBe(200);

    // The retry can no longer authenticate (revoked), so it is refused and
    // mints nothing: this conversation's successor count stays at one.
    expect((await clearConversation(old)).status).toBe(404);
    expect(
      (await sql<{ n: number }>("SELECT COUNT(*) AS n FROM conversations WHERE id = ? AND replaced_by IS NOT NULL", old.id)).n,
    ).toBe(1);
  });

  it("refuses an unauthenticated clear and one with another conversation's token", async () => {
    const { POST } = await import("../src/app/api/v1/conversations/[id]/clear/route");
    const unauthenticated = await POST(
      new Request(`${TEST_ORIGIN}/api/v1/conversations/unknown/clear`, { method: "POST" }),
      { params: Promise.resolve({ id: "unknown" }) },
    );
    expect(unauthenticated.status).toBe(401);

    const mine = await startConversation();
    const theirs = await escalatedConversation("Clear test: token confusion, nothing covers this.");
    const cross = await POST(
      new Request(`${TEST_ORIGIN}/api/v1/conversations/${theirs.id}/clear`, {
        method: "POST",
        headers: { Authorization: `Bearer ${mine.token}` },
      }),
      { params: Promise.resolve({ id: theirs.id }) },
    );
    expect(cross.status).toBe(404);
    // Their conversation is untouched.
    expect((await loadHistory(theirs)).status).toBe(200);
  });

  it("still clears a conversation the staff side already closed", async () => {
    const old = await escalatedConversation("Clear test: staff closed first, nothing covers this.");
    const jar = await staffJar();
    expect((await staffAction(jar, old.id, "claim")).status).toBe(200);
    const { POST: closeRoute } = await import("../src/app/api/staff/conversations/[id]/close/route");
    expect((
      await closeRoute(
        new Request(`${TEST_ORIGIN}/api/staff/conversations/${old.id}/close`, {
          method: "POST",
          headers: { cookie: jar.header(), origin: TEST_ORIGIN },
        }),
        { params: Promise.resolve({ id: old.id }) },
      )
    ).status).toBe(200);
    const closedAtBefore = (
      await sql<{ closed_at: string }>("SELECT closed_at FROM conversations WHERE id = ?", old.id)
    ).closed_at;

    const response = await clearConversation(old);
    expect(response.status).toBe(200);
    const fresh = (await response.json()) as ClearResponse;

    // The staff closure timestamp is preserved, not re-stamped.
    expect(
      (await sql<{ closed_at: string }>("SELECT closed_at FROM conversations WHERE id = ?", old.id)).closed_at,
    ).toBe(closedAtBefore);
    expect((await submitContact({ id: fresh.id, token: fresh.token })).status).toBe(200);
    expect((await ask({ id: fresh.id, token: fresh.token }, "Clear test: fresh after staff closure.")).status).toBe(200);
  });
});
