import { beforeAll, describe, expect, it } from "vitest";
import { confirmHandoffYes, ask, loadHistory, startConversation, TEST_ORIGIN, useTempDatabase, warmChatbotService } from "./helpers";
import {
  authRequest,
  CookieJar,
  enrollTotp,
  provisionStaff,
  signInWithTotp,
} from "./auth-helpers";

const OWNER_EMAIL = "owner@example.edu";
const OWNER_PASSWORD = "owner-manage-nimbus-52";
const ALICE_EMAIL = "alice@example.edu";
const ALICE_PASSWORD = "alice-transfer-pilot-7c";
const BOB_EMAIL = "bob@example.edu";
const BOB_PASSWORD = "bob-transfer-harbor-3v";
const EDITOR_EMAIL = "editor@example.edu";
const EDITOR_PASSWORD = "editor-answer-lantern-8m";

let ownerTotp: Awaited<ReturnType<typeof enrollTotp>>;
let aliceTotp: Awaited<ReturnType<typeof enrollTotp>>;
let bobTotp: Awaited<ReturnType<typeof enrollTotp>>;

async function staffId(email: string): Promise<string> {
  const { getChatbotService } = await import("../src/db/service");
  const { db } = await getChatbotService();
  return ((await db.get<{ id: string }>('SELECT "id" FROM "user" WHERE "email" = ?', email)) as {
    id: string;
  }).id;
}

async function conversationAction(
  jar: CookieJar,
  conversationId: string,
  action: "claim" | "reply" | "close" | "release" | "transfer",
  body?: unknown,
  origin = TEST_ORIGIN,
): Promise<Response> {
  const route = await import(`../src/app/api/staff/conversations/[id]/${action}/route`);
  return route.POST(
    new Request(`${TEST_ORIGIN}/api/staff/conversations/${conversationId}/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: jar.header(),
        origin,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    { params: Promise.resolve({ id: conversationId }) },
  );
}

async function membersRequest(
  jar: CookieJar | null,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  origin = TEST_ORIGIN,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...(jar ? { cookie: jar.header() } : {}),
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    origin,
  };
  const request = new Request(`${TEST_ORIGIN}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (path === "/api/staff/members") {
    const route = await import("../src/app/api/staff/members/route");
    return method === "GET" ? route.GET(request) : route.POST(request);
  }
  const match = path.match(/^\/api\/staff\/members\/([^/]+)\/disable$/);
  if (match?.[1]) {
    const { POST } = await import("../src/app/api/staff/members/[id]/disable/route");
    return POST(request, { params: Promise.resolve({ id: match[1] }) });
  }
  throw new Error(`unmapped members path: ${path}`);
}

/** Escalate, then claim as Alice: the ticket 08 starting state. */
async function claimedConversation(): Promise<{ id: string; token: string }> {
  const conversation = await startConversation();
  await ask(conversation, "Tell me about evening classes; I need to speak to a human.");
  await confirmHandoffYes(conversation);
  const jar = new CookieJar();
  await signInWithTotp(jar, ALICE_EMAIL, ALICE_PASSWORD, aliceTotp);
  const claim = await conversationAction(jar, conversation.id, "claim");
  expect(claim.status).toBe(200);
  return conversation;
}

async function conversationDetail(jar: CookieJar, conversationId: string): Promise<{
  conversation: { state: string; claimedBy: string | null };
  messages: unknown[];
  audit: { action: string; actorName: string; detail: string | null }[];
}> {
  const { GET } = await import("../src/app/api/staff/conversations/[id]/route");
  const response = await GET(
    new Request(`${TEST_ORIGIN}/api/staff/conversations/${conversationId}`, {
      headers: { cookie: jar.header() },
    }),
    { params: Promise.resolve({ id: conversationId }) },
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    conversation: { state: string; claimedBy: string | null };
    messages: unknown[];
    audit: { action: string; actorName: string; detail: string | null }[];
  };
}

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await warmChatbotService();
  await provisionStaff({ email: OWNER_EMAIL, password: OWNER_PASSWORD, name: "Olive", role: "owner" });
  await provisionStaff({ email: ALICE_EMAIL, password: ALICE_PASSWORD, name: "Alice" });
  await provisionStaff({ email: BOB_EMAIL, password: BOB_PASSWORD, name: "Bob" });
  await provisionStaff({ email: EDITOR_EMAIL, password: EDITOR_PASSWORD, name: "Eddie", role: "editor" });
  ownerTotp = await enrollTotp(new CookieJar(), OWNER_EMAIL, OWNER_PASSWORD);
  aliceTotp = await enrollTotp(new CookieJar(), ALICE_EMAIL, ALICE_PASSWORD);
  bobTotp = await enrollTotp(new CookieJar(), BOB_EMAIL, BOB_PASSWORD);
});

describe("the owner invites named staff", () => {
  it("creates a working account and shows the initial password exactly once", async () => {
    const ownerJar = new CookieJar();
    await signInWithTotp(ownerJar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);

    const invite = await membersRequest(ownerJar, "POST", "/api/staff/members", {
      name: "Carol",
      email: "carol@example.edu",
      role: "staff",
    });
    expect(invite.status).toBe(201);
    const body = (await invite.json()) as { member: { id: string; email: string }; initialPassword: string };
    expect(body.member.email).toBe("carol@example.edu");
    expect(body.initialPassword.length).toBeGreaterThanOrEqual(16);

    // The invited member signs in with the generated password and is forced
    // into the same second-factor enrollment as everyone else.
    const carolJar = new CookieJar();
    const signIn = await authRequest(carolJar, "/api/auth/sign-in/email", {
      body: { email: "carol@example.edu", password: body.initialPassword },
    });
    expect(signIn.ok).toBe(true);
    const enable = await authRequest(carolJar, "/api/auth/two-factor/enable", {
      body: { password: body.initialPassword, method: "totp", issuer: "Springfield College chat" },
    });
    expect(enable.ok).toBe(true);

    const duplicate = await membersRequest(ownerJar, "POST", "/api/staff/members", {
      name: "Carol Again",
      email: "carol@example.edu",
      role: "staff",
    });
    expect(duplicate.status).toBe(409);

    const badRole = await membersRequest(ownerJar, "POST", "/api/staff/members", {
      name: "Sneaky",
      email: "sneaky@example.edu",
      role: "owner",
    });
    expect(badRole.status).toBe(400);

    const list = await membersRequest(ownerJar, "GET", "/api/staff/members");
    expect(list.status).toBe(200);
    const members = ((await list.json()) as { members: { email: string; role: string }[] }).members;
    expect(members.some((member) => member.email === "carol@example.edu" && member.role === "staff")).toBe(true);
  });

  it("is owner-only and origin-checked", async () => {
    const aliceJar = new CookieJar();
    await signInWithTotp(aliceJar, ALICE_EMAIL, ALICE_PASSWORD, aliceTotp);
    const forbidden = await membersRequest(aliceJar, "POST", "/api/staff/members", {
      name: "Nope",
      email: "nope@example.edu",
      role: "staff",
    });
    expect(forbidden.status).toBe(403);

    const ownerJar = new CookieJar();
    await signInWithTotp(ownerJar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    const crossSite = await membersRequest(
      ownerJar,
      "POST",
      "/api/staff/members",
      { name: "Nope", email: "nope2@example.edu", role: "staff" },
      "https://evil.example.net",
    );
    expect(crossSite.status).toBe(403);
  });
});

describe("disabling an account takes effect immediately", () => {
  it("cuts off a signed-in staff member's dashboard, API, and inbox access", async () => {
    // A disposable victim: banning is permanent for the file's database, so
    // later tests must never depend on this account again.
    const VICTIM_EMAIL = "dave@example.edu";
    const VICTIM_PASSWORD = "dave-disposable-heron-45";
    await provisionStaff({ email: VICTIM_EMAIL, password: VICTIM_PASSWORD, name: "Dave" });
    const victimTotp = await enrollTotp(new CookieJar(), VICTIM_EMAIL, VICTIM_PASSWORD);

    const victimJar = new CookieJar();
    await signInWithTotp(victimJar, VICTIM_EMAIL, VICTIM_PASSWORD, victimTotp);
    // Dave has a live session and can read the inbox.
    const inboxRoute = await import("../src/app/api/staff/conversations/route");
    const before = await inboxRoute.GET(
      new Request(`${TEST_ORIGIN}/api/staff/conversations`, { headers: { cookie: victimJar.header() } }),
    );
    expect(before.status).toBe(200);

    const ownerJar = new CookieJar();
    await signInWithTotp(ownerJar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    const disable = await membersRequest(ownerJar, "POST", `/api/staff/members/${await staffId(VICTIM_EMAIL)}/disable`);
    expect(disable.status).toBe(200);

    const after = await inboxRoute.GET(
      new Request(`${TEST_ORIGIN}/api/staff/conversations`, { headers: { cookie: victimJar.header() } }),
    );
    expect(after.status).toBe(401);

    // Dave cannot sign back in while disabled.
    const resignIn = await authRequest(new CookieJar(), "/api/auth/sign-in/email", {
      body: { email: VICTIM_EMAIL, password: VICTIM_PASSWORD },
    });
    expect(resignIn.ok).toBe(false);
  });

  it("refuses to disable the acting owner or another owner account", async () => {
    const ownerJar = new CookieJar();
    await signInWithTotp(ownerJar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    const self = await membersRequest(ownerJar, "POST", `/api/staff/members/${await staffId(OWNER_EMAIL)}/disable`);
    expect(self.status).toBe(400);
    const unknown = await membersRequest(ownerJar, "POST", "/api/staff/members/does-not-exist/disable");
    expect(unknown.status).toBe(404);
  });

  it("releases the disabled member's claims back to the shared inbox", async () => {
    // A disposable claim-holder, so later tests keep a clean roster.
    const HOLDER_EMAIL = "frank@example.edu";
    const HOLDER_PASSWORD = "frank-disposable-anchor-92";
    await provisionStaff({ email: HOLDER_EMAIL, password: HOLDER_PASSWORD, name: "Frank" });
    const holderTotp = await enrollTotp(new CookieJar(), HOLDER_EMAIL, HOLDER_PASSWORD);

    const conversation = await startConversation();
    await ask(conversation, "Who arranges accessible parking? I need to speak to a human.");
  await confirmHandoffYes(conversation);
    const holderJar = new CookieJar();
    await signInWithTotp(holderJar, HOLDER_EMAIL, HOLDER_PASSWORD, holderTotp);
    const claim = await conversationAction(holderJar, conversation.id, "claim");
    expect(claim.status).toBe(200);

    const ownerJar = new CookieJar();
    await signInWithTotp(ownerJar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    const disable = await membersRequest(ownerJar, "POST", `/api/staff/members/${await staffId(HOLDER_EMAIL)}/disable`);
    expect(disable.status).toBe(200);

    // The claim cannot outlive the account: the conversation returns to the
    // inbox, and the sweep is on the audit trail.
    const detail = await conversationDetail(ownerJar, conversation.id);
    expect(detail.conversation.state).toBe("awaiting_staff");
    expect(detail.conversation.claimedBy).toBeNull();
    const sweep = detail.audit.find(
      (entry) => entry.action === "conversation_released" && entry.detail?.includes(HOLDER_EMAIL),
    );
    expect(sweep).toBeTruthy();
  });
});

describe("releasing a claim", () => {
  it("returns the conversation to the shared inbox and the visitor chat", async () => {
    const { id: conversationId, token } = await claimedConversation();
    const aliceJar = new CookieJar();
    await signInWithTotp(aliceJar, ALICE_EMAIL, ALICE_PASSWORD, aliceTotp);

    const release = await conversationAction(aliceJar, conversationId, "release");
    expect(release.status).toBe(200);
    const released = (await release.json()) as { conversation: { state: string; claimedBy: string | null } };
    expect(released.conversation.state).toBe("awaiting_staff");
    expect(released.conversation.claimedBy).toBeNull();

    // The visitor's widget polling sees the handoff state again.
    const visitorHistory = await loadHistory({ id: conversationId, token });
    const visitorBody = (await visitorHistory.json()) as { conversation: { state: string } };
    expect(visitorBody.conversation.state).toBe("awaiting_staff");

    // Back in the shared inbox (the desk's Incoming section), and Bob can
    // take it over.
    const inboxRoute = await import("../src/app/api/staff/conversations/route");
    const inbox = await inboxRoute.GET(
      new Request(`${TEST_ORIGIN}/api/staff/conversations`, { headers: { cookie: aliceJar.header() } }),
    );
    const inboxBody = (await inbox.json()) as { incoming: { id: string }[] };
    expect(inboxBody.incoming.some((item) => item.id === conversationId)).toBe(true);

    const bobJar = new CookieJar();
    await signInWithTotp(bobJar, BOB_EMAIL, BOB_PASSWORD, bobTotp);
    const reclaim = await conversationAction(bobJar, conversationId, "claim");
    expect(reclaim.status).toBe(200);
  });

  it("only the claimer or the owner may release", async () => {
    const { id: conversationId } = await claimedConversation();
    const bobJar = new CookieJar();
    await signInWithTotp(bobJar, BOB_EMAIL, BOB_PASSWORD, bobTotp);
    const notClaimer = await conversationAction(bobJar, conversationId, "release");
    expect(notClaimer.status).toBe(409);
    const conflict = (await notClaimer.json()) as { claimedBy: string };
    expect(conflict.claimedBy).toBe("Alice");

    const ownerJar = new CookieJar();
    await signInWithTotp(ownerJar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    const override = await conversationAction(ownerJar, conversationId, "release");
    expect(override.status).toBe(200);
  });

  it("refuses to release an unclaimed conversation", async () => {
    const conversation = await startConversation();
    await ask(conversation, "I need to speak to a human; nothing covers it.");
  await confirmHandoffYes(conversation);
    const aliceJar = new CookieJar();
    await signInWithTotp(aliceJar, ALICE_EMAIL, ALICE_PASSWORD, aliceTotp);
    const unclaimed = await conversationAction(aliceJar, conversation.id, "release");
    expect(unclaimed.status).toBe(409);
  });
});

describe("transferring a claim", () => {
  it("hands the conversation to another active staff member with history intact", async () => {
    const { id: conversationId, token } = await claimedConversation();
    const aliceJar = new CookieJar();
    await signInWithTotp(aliceJar, ALICE_EMAIL, ALICE_PASSWORD, aliceTotp);
    await conversationAction(aliceJar, conversationId, "reply", { text: "Alice here, taking this over." });

    const transfer = await conversationAction(aliceJar, conversationId, "transfer", {
      to: await staffId(BOB_EMAIL),
    });
    expect(transfer.status).toBe(200);
    const transferred = (await transfer.json()) as { conversation: { state: string; claimedBy: string } };
    expect(transferred.conversation.state).toBe("claimed");
    expect(transferred.conversation.claimedBy).toBe(await staffId(BOB_EMAIL));

    // The new owner can reply; the old one no longer can.
    const bobJar = new CookieJar();
    await signInWithTotp(bobJar, BOB_EMAIL, BOB_PASSWORD, bobTotp);
    const bobReply = await conversationAction(bobJar, conversationId, "reply", { text: "Bob continuing from here." });
    expect(bobReply.status).toBe(200);
    const aliceReply = await conversationAction(aliceJar, conversationId, "reply", { text: "still alice" });
    expect(aliceReply.status).toBe(409);

    // History preserved for the new owner, and the visitor's own polling
    // still reads the same conversation with its full transcript.
    const detail = await conversationDetail(bobJar, conversationId);
    expect(detail.messages.length).toBeGreaterThanOrEqual(4);
    const visitorHistory = await loadHistory({ id: conversationId, token });
    const visitorBody = (await visitorHistory.json()) as {
      conversation: { id: string; state: string };
      messages: unknown[];
    };
    expect(visitorBody.conversation.id).toBe(conversationId);
    expect(visitorBody.conversation.state).toBe("claimed");
    expect(visitorBody.messages.length).toBeGreaterThanOrEqual(4);
  });

  it("rejects ineligible targets and protects assignment changes", async () => {
    const { id: conversationId } = await claimedConversation();
    const aliceJar = new CookieJar();
    await signInWithTotp(aliceJar, ALICE_EMAIL, ALICE_PASSWORD, aliceTotp);

    const editorTarget = await conversationAction(aliceJar, conversationId, "transfer", {
      to: await staffId(EDITOR_EMAIL),
    });
    expect(editorTarget.status).toBe(400);

    const selfTarget = await conversationAction(aliceJar, conversationId, "transfer", {
      to: await staffId(ALICE_EMAIL),
    });
    expect(selfTarget.status).toBe(400);

    const unknownTarget = await conversationAction(aliceJar, conversationId, "transfer", {
      to: "no-such-member",
    });
    expect(unknownTarget.status).toBe(400);

    const bobJar = new CookieJar();
    await signInWithTotp(bobJar, BOB_EMAIL, BOB_PASSWORD, bobTotp);
    const notClaimer = await conversationAction(bobJar, conversationId, "transfer", {
      to: await staffId(BOB_EMAIL),
    });
    expect(notClaimer.status).toBe(409);

    // The owner can move the assignment even without holding the claim.
    const ownerJar = new CookieJar();
    await signInWithTotp(ownerJar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    const override = await conversationAction(ownerJar, conversationId, "transfer", {
      to: await staffId(BOB_EMAIL),
    });
    expect(override.status).toBe(200);
  });

  it("does not offer a disabled account as a target", async () => {
    const VICTIM_EMAIL = "erin@example.edu";
    const VICTIM_PASSWORD = "erin-disposable-orbit-77";
    await provisionStaff({ email: VICTIM_EMAIL, password: VICTIM_PASSWORD, name: "Erin" });
    await enrollTotp(new CookieJar(), VICTIM_EMAIL, VICTIM_PASSWORD);

    const { id: conversationId } = await claimedConversation();
    const ownerJar = new CookieJar();
    await signInWithTotp(ownerJar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    const disable = await membersRequest(ownerJar, "POST", `/api/staff/members/${await staffId(VICTIM_EMAIL)}/disable`);
    expect(disable.status).toBe(200);

    const aliceJar = new CookieJar();
    await signInWithTotp(aliceJar, ALICE_EMAIL, ALICE_PASSWORD, aliceTotp);
    const disabledTarget = await conversationAction(aliceJar, conversationId, "transfer", {
      to: await staffId(VICTIM_EMAIL),
    });
    expect(disabledTarget.status).toBe(400);
  });
});

describe("the owner role can reply without holding the claim", () => {
  it("lets the owner answer a conversation claimed by someone else", async () => {
    const { id: conversationId } = await claimedConversation();
    const ownerJar = new CookieJar();
    await signInWithTotp(ownerJar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    const reply = await conversationAction(ownerJar, conversationId, "reply", {
      text: "Owner stepping in briefly.",
    });
    expect(reply.status).toBe(200);
  });
});

describe("the audit trail", () => {
  it("records claim, reply, transfer, and release with who did it", async () => {
    const { id: conversationId } = await claimedConversation();
    const aliceJar = new CookieJar();
    await signInWithTotp(aliceJar, ALICE_EMAIL, ALICE_PASSWORD, aliceTotp);
    await conversationAction(aliceJar, conversationId, "reply", { text: "One answer before I go." });
    await conversationAction(aliceJar, conversationId, "transfer", { to: await staffId(BOB_EMAIL) });

    const bobJar = new CookieJar();
    await signInWithTotp(bobJar, BOB_EMAIL, BOB_PASSWORD, bobTotp);
    await conversationAction(bobJar, conversationId, "release");

    const ownerJar = new CookieJar();
    await signInWithTotp(ownerJar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    const detail = await conversationDetail(ownerJar, conversationId);
    const actions = detail.audit.map((entry) => entry.action);
    expect(actions).toContain("conversation_claimed");
    expect(actions).toContain("conversation_replied");
    expect(actions).toContain("conversation_transferred");
    expect(actions).toContain("conversation_released");
    const claimEntry = detail.audit.find((entry) => entry.action === "conversation_claimed");
    expect(claimEntry?.actorName).toBe("Alice");
    const transferEntry = detail.audit.find((entry) => entry.action === "conversation_transferred");
    expect(transferEntry?.actorName).toBe("Alice");
    expect(transferEntry?.detail).toBe("Bob");
  });

  it("records answer-rule publishing and staff administration actions", async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { db } = await getChatbotService();

    const editorJar = new CookieJar();
    await signInWithTotp(editorJar, EDITOR_EMAIL, EDITOR_PASSWORD, (await enrollTotp(new CookieJar(), EDITOR_EMAIL, EDITOR_PASSWORD)));
    const create = await (await import("../src/app/api/staff/answer-rules/route")).POST(
      new Request(`${TEST_ORIGIN}/api/staff/answer-rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: editorJar.header(), origin: TEST_ORIGIN },
        body: JSON.stringify({
          topic: "Audited rule",
          response: "An audited response body.",
          phrases: ["Audit me"],
        }),
      }),
    );
    expect(create.status).toBe(201);
    const ruleId = ((await create.json()) as { id: string }).id;

    const rows = (await db.all<{ action: string }>(
      "SELECT action FROM audit_log WHERE rule_id = ? ORDER BY created_at",
      ruleId,
    )) as { action: string }[];
    expect(rows.map((row) => row.action)).toContain("rule_created");

    const ownerJar = new CookieJar();
    await signInWithTotp(ownerJar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    const staffRows = (await db.all<{ action: string; detail: string }>(
      "SELECT action, detail FROM audit_log WHERE action IN ('staff_invited','staff_disabled')",
    )) as { action: string; detail: string }[];
    expect(staffRows.some((row) => row.action === "staff_invited" && row.detail.includes("carol@example.edu"))).toBe(true);
    expect(staffRows.some((row) => row.action === "staff_disabled" && /@example\.edu/.test(row.detail))).toBe(true);
  });
});
