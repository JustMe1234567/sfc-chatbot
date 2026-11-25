import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { repoRoot } from "../src/paths";
import { confirmHandoffYes, ask, loadHistory, startConversation, TEST_ORIGIN, useTempDatabase, warmChatbotService } from "./helpers";
import {
  authRequest,
  CookieJar,
  latestOutboxMail,
  provisionStaff,
  staffApiRequest,
  signInAs,
} from "./auth-helpers";

const ADMIN_EMAIL = "admin@example.edu";
const ADMIN_PASSWORD = "admin-manage-nimbus-52";
const SECOND_ADMIN_EMAIL = "second-admin@example.edu";
const SECOND_ADMIN_PASSWORD = "second-admin-manage-pilot-63";
const ALICE_EMAIL = "alice@example.edu";
const ALICE_PASSWORD = "alice-transfer-pilot-7c";
const BOB_EMAIL = "bob@example.edu";
const BOB_PASSWORD = "bob-transfer-harbor-3v";
const EDDIE_EMAIL = "editor@example.edu";
const EDDIE_PASSWORD = "editor-answer-lantern-8m";

async function staffId(email: string): Promise<string> {
  const { getChatbotService } = await import("../src/db/service");
  const { db } = await getChatbotService();
  const username = email.split("@")[0]!.toLowerCase();
  return ((await db.get<{ id: string }>('SELECT "id" FROM staff_members WHERE "username" = ?', username)) as {
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
  const passwordReset = path.match(/^\/api\/staff\/members\/([^/]+)\/reset-password$/);
  if (passwordReset?.[1]) {
    const { POST } = await import("../src/app/api/staff/members/[id]/reset-password/route");
    return POST(request, { params: Promise.resolve({ id: passwordReset[1] }) });
  }
  throw new Error(`unmapped members path: ${path}`);
}

/** Escalate, then claim as Alice: the ticket 08 starting state. */
async function claimedConversation(): Promise<{ id: string; token: string }> {
  const conversation = await startConversation();
  await ask(conversation, "Tell me about evening classes; I need to speak to a human.");
  await confirmHandoffYes(conversation);
  const jar = new CookieJar();
  await signInAs(jar, ALICE_EMAIL, ALICE_PASSWORD);
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
  await provisionStaff({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: "Olive", role: "admin" });
  await provisionStaff({ email: SECOND_ADMIN_EMAIL, password: SECOND_ADMIN_PASSWORD, name: "Sana", role: "admin" });
  await provisionStaff({ email: ALICE_EMAIL, password: ALICE_PASSWORD, name: "Alice" });
  await provisionStaff({ email: BOB_EMAIL, password: BOB_PASSWORD, name: "Bob" });
  await provisionStaff({ email: EDDIE_EMAIL, password: EDDIE_PASSWORD, name: "Eddie" });
});

describe("an admin manages admissions advisor accounts", () => {
  it("creates an active Admissions Advisor account with an admin-set password, without sending email", async () => {
    const adminJar = new CookieJar();
    await signInAs(adminJar, ADMIN_EMAIL, ADMIN_PASSWORD);

    // The form sends no role: the Admissions Advisor is the only creatable role.
    const create = await membersRequest(adminJar, "POST", "/api/staff/members", {
      name: "Carol",
      username: "carol",
      password: "carol-secure-password-42",
    });
    expect(create.status, await create.clone().text()).toBe(201);
    const body = (await create.json()) as { member: { id: string; username: string; role: string } };
    expect(body.member.username).toBe("carol");
    expect(body.member.role).toBe("admissions_advisor");
    expect(JSON.stringify(body)).not.toContain("password");
    const outboxCount = await (await import("../src/db/service")).getChatbotService()
      .then(({ db }) => db.get<{ n: number }>("SELECT COUNT(*) AS n FROM mail_outbox"));
    expect(Number(outboxCount?.n ?? 0)).toBe(0);
    const duplicate = await membersRequest(adminJar, "POST", "/api/staff/members", {
      name: "Carol Again",
      username: "carol",
      password: "different-secure-password-42",
    });
    expect(duplicate.status).toBe(409);

    // No dashboard request creates an Admin, whatever role it asks for.
    for (const role of ["admin", "owner", "staff", "editor"]) {
      const refused = await membersRequest(adminJar, "POST", "/api/staff/members", {
        name: "Sneaky",
        username: "sneaky",
        password: "sneaky-secure-password-42",
        role,
      });
      expect(refused.status, `role ${role}`).toBe(400);
    }

    const list = await membersRequest(adminJar, "GET", "/api/staff/members");
    expect(list.status).toBe(200);
    const members = ((await list.json()) as { members: { username: string; role: string }[] }).members;
    expect(members.some((member) => member.username === "carol" && member.role === "admissions_advisor")).toBe(true);
    // The roster holds exactly the two roles, and only the provisioned admins are Admins.
    expect([...new Set(members.map((member) => member.role))].sort()).toEqual(["admin", "admissions_advisor"]);
    expect(members.filter((member) => member.role === "admin").map((member) => member.username).sort())
      .toEqual(["admin", "second-admin"]);
  });

  it("is admin-only and origin-checked", async () => {
    const aliceJar = new CookieJar();
    await signInAs(aliceJar, ALICE_EMAIL, ALICE_PASSWORD);
    const forbidden = await membersRequest(aliceJar, "POST", "/api/staff/members", {
      name: "Nope",
      email: "nope@example.edu",
    });
    expect(forbidden.status).toBe(403);
    // Admissions Advisors have no Staff accounts area: the roster is refused too.
    const roster = await membersRequest(aliceJar, "GET", "/api/staff/members");
    expect(roster.status).toBe(403);

    const adminJar = new CookieJar();
    await signInAs(adminJar, ADMIN_EMAIL, ADMIN_PASSWORD);
    const crossSite = await membersRequest(
      adminJar,
      "POST",
      "/api/staff/members",
      { name: "Nope", email: "nope2@example.edu" },
      "https://evil.example.net",
    );
    expect(crossSite.status).toBe(403);
  });

  it("resets an advisor's password and revokes that advisor's sessions", async () => {
    const adminJar = new CookieJar();
    await signInAs(adminJar, ADMIN_EMAIL, ADMIN_PASSWORD);
    const created = await membersRequest(adminJar, "POST", "/api/staff/members", {
      name: "Diana",
      username: "diana",
      password: "diana-original-password-42",
    });
    const member = (await created.json()) as { member: { userId: string } };
    const active = new CookieJar();
    await signInAs(active, "diana", "diana-original-password-42");

    const reset = await membersRequest(
      adminJar,
      "POST",
      `/api/staff/members/${member.member.userId}/reset-password`,
      { password: "diana-replacement-password-84" },
    );
    expect(reset.status).toBe(200);
    expect((await staffApiRequest(active, "/api/staff/conversations")).status).toBe(401);
    // The second factor left the auth surface entirely (ticket 82): the
    // enrollment route answers not_found.
    expect((await authRequest(active, "/api/auth/two-factor/enable", { body: {} })).status).toBe(404);
    expect((await authRequest(new CookieJar(), "/api/auth/sign-in/username", {
      body: { username: "diana", password: "diana-original-password-42" },
    })).status).toBe(401);

    const replacement = new CookieJar();
    await signInAs(replacement, "diana", "diana-replacement-password-84");
    expect((await staffApiRequest(replacement, "/api/staff/conversations")).status).toBe(200);
  });

  it("refuses an advisor on create, reset, and disable", async () => {
    const aliceJar = new CookieJar();
    await signInAs(aliceJar, ALICE_EMAIL, ALICE_PASSWORD);
    const bobId = await staffId(BOB_EMAIL);

    const create = await membersRequest(aliceJar, "POST", "/api/staff/members", {
      name: "Not Allowed",
      username: "not-allowed",
      password: "not-allowed-password-42",
    });
    expect(create.status).toBe(403);
    const reset = await membersRequest(aliceJar, "POST", `/api/staff/members/${bobId}/reset-password`, {
      password: "hijacked-password-42",
    });
    expect(reset.status).toBe(403);
    const disable = await membersRequest(aliceJar, "POST", `/api/staff/members/${bobId}/disable`);
    expect(disable.status).toBe(403);

    // Bob's password and access are untouched.
    const bobJar = new CookieJar();
    await signInAs(bobJar, BOB_EMAIL, BOB_PASSWORD);
    expect((await staffApiRequest(bobJar, "/api/staff/conversations")).status).toBe(200);
  });

  it("cannot reset or disable an Admin account, including its own", async () => {
    const adminJar = new CookieJar();
    await signInAs(adminJar, ADMIN_EMAIL, ADMIN_PASSWORD);
    const otherAdminId = await staffId(SECOND_ADMIN_EMAIL);

    const reset = await membersRequest(adminJar, "POST", `/api/staff/members/${otherAdminId}/reset-password`, {
      password: "hijacked-admin-password-42",
    });
    expect(reset.status).toBe(400);
    const disable = await membersRequest(adminJar, "POST", `/api/staff/members/${otherAdminId}/disable`);
    expect(disable.status).toBe(400);
    const self = await membersRequest(adminJar, "POST", `/api/staff/members/${await staffId(ADMIN_EMAIL)}/disable`);
    expect(self.status).toBe(400);

    // The other Admin still signs in with the original password.
    const otherAdmin = new CookieJar();
    await signInAs(otherAdmin, SECOND_ADMIN_EMAIL, SECOND_ADMIN_PASSWORD);
    expect((await staffApiRequest(otherAdmin, "/api/staff/members")).status).toBe(200);
  });

  it("lets a signed-in advisor change their own password without revoking sessions (ticket 82 amendment)", async () => {
    await provisionStaff({ email: "self-change@example.edu", password: "self-change-password-42", name: "Self Change" });
    const jar = new CookieJar();
    await signInAs(jar, "self-change", "self-change-password-42");
    // A second live session of the same account, as another browser holds.
    const second = new CookieJar();
    await signInAs(second, "self-change", "self-change-password-42");
    const changed = await authRequest(jar, "/api/auth/change-password", {
      body: { newPassword: "bob-new-secure-password-94" },
    });
    expect(changed.status).toBe(200);
    // A self-service change revokes nothing: the acting session and the
    // account's other live session keep working. Only admin-issued resets
    // wipe every session.
    expect((await staffApiRequest(jar, "/api/staff/conversations")).status).toBe(200);
    expect((await staffApiRequest(second, "/api/staff/conversations")).status).toBe(200);

    // Fresh sign-ins require the new password; the old one no longer works.
    const fresh = new CookieJar();
    await signInAs(fresh, "self-change", "bob-new-secure-password-94");
    expect((await staffApiRequest(fresh, "/api/staff/conversations")).status).toBe(200);
    const stale = new CookieJar();
    const oldPassword = await authRequest(stale, "/api/auth/sign-in/username", {
      body: { username: "self-change", password: "self-change-password-42" },
    });
    expect(oldPassword.status).toBe(401);
  });
});

describe("disabling an account takes effect immediately", () => {
  it("cuts off a signed-in advisor's dashboard, API, and inbox access", async () => {
    // A disposable victim: banning is permanent for the file's database, so
    // later tests must never depend on this account again.
    const VICTIM_EMAIL = "dave@example.edu";
    const VICTIM_PASSWORD = "dave-disposable-heron-45";
    await provisionStaff({ email: VICTIM_EMAIL, password: VICTIM_PASSWORD, name: "Dave" });
    const victimJar = new CookieJar();
    await signInAs(victimJar, VICTIM_EMAIL, VICTIM_PASSWORD);
    // Dave has a live session and can read the inbox.
    const inboxRoute = await import("../src/app/api/staff/conversations/route");
    const before = await inboxRoute.GET(
      new Request(`${TEST_ORIGIN}/api/staff/conversations`, { headers: { cookie: victimJar.header() } }),
    );
    expect(before.status).toBe(200);

    const adminJar = new CookieJar();
    await signInAs(adminJar, ADMIN_EMAIL, ADMIN_PASSWORD);
    const disable = await membersRequest(adminJar, "POST", `/api/staff/members/${await staffId(VICTIM_EMAIL)}/disable`);
    expect(disable.status).toBe(200);

    const after = await inboxRoute.GET(
      new Request(`${TEST_ORIGIN}/api/staff/conversations`, { headers: { cookie: victimJar.header() } }),
    );
    expect(after.status).toBe(401);

    // Dave cannot sign back in while disabled.
    const resignIn = await authRequest(new CookieJar(), "/api/auth/sign-in/username", {
      body: { username: "dave", password: VICTIM_PASSWORD },
    });
    expect(resignIn.ok).toBe(false);
  });

  it("refuses to disable the acting admin and reports an unknown account", async () => {
    const adminJar = new CookieJar();
    await signInAs(adminJar, ADMIN_EMAIL, ADMIN_PASSWORD);
    const self = await membersRequest(adminJar, "POST", `/api/staff/members/${await staffId(ADMIN_EMAIL)}/disable`);
    expect(self.status).toBe(400);
    const unknown = await membersRequest(adminJar, "POST", "/api/staff/members/does-not-exist/disable");
    expect(unknown.status).toBe(404);
  });

  it("releases the disabled member's claims back to the shared inbox", async () => {
    // A disposable claim-holder, so later tests keep a clean roster.
    const HOLDER_EMAIL = "frank@example.edu";
    const HOLDER_PASSWORD = "frank-disposable-anchor-92";
    await provisionStaff({ email: HOLDER_EMAIL, password: HOLDER_PASSWORD, name: "Frank" });
    const conversation = await startConversation();
    await ask(conversation, "Who arranges accessible parking? I need to speak to a human.");
  await confirmHandoffYes(conversation);
    const holderJar = new CookieJar();
    await signInAs(holderJar, HOLDER_EMAIL, HOLDER_PASSWORD);
    const claim = await conversationAction(holderJar, conversation.id, "claim");
    expect(claim.status).toBe(200);

    const adminJar = new CookieJar();
    await signInAs(adminJar, ADMIN_EMAIL, ADMIN_PASSWORD);
    const disable = await membersRequest(adminJar, "POST", `/api/staff/members/${await staffId(HOLDER_EMAIL)}/disable`);
    expect(disable.status).toBe(200);

    // The claim cannot outlive the account: the conversation returns to the
    // inbox, and the sweep is on the audit trail.
    const detail = await conversationDetail(adminJar, conversation.id);
    expect(detail.conversation.state).toBe("awaiting_staff");
    expect(detail.conversation.claimedBy).toBeNull();
    const sweep = detail.audit.find(
      (entry) => entry.action === "conversation_released" && entry.detail?.includes("frank"),
    );
    expect(sweep).toBeTruthy();
  });
});

describe("releasing a claim", () => {
  it("returns the conversation to the shared inbox and the visitor chat", async () => {
    const { id: conversationId, token } = await claimedConversation();
    const aliceJar = new CookieJar();
    await signInAs(aliceJar, ALICE_EMAIL, ALICE_PASSWORD);

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
    await signInAs(bobJar, BOB_EMAIL, BOB_PASSWORD);
    const reclaim = await conversationAction(bobJar, conversationId, "claim");
    expect(reclaim.status).toBe(200);
  });

  it("only the claimer or an admin may release", async () => {
    const { id: conversationId } = await claimedConversation();
    const bobJar = new CookieJar();
    await signInAs(bobJar, BOB_EMAIL, BOB_PASSWORD);
    const notClaimer = await conversationAction(bobJar, conversationId, "release");
    expect(notClaimer.status).toBe(409);
    const conflict = (await notClaimer.json()) as { claimedBy: string };
    expect(conflict.claimedBy).toBe("Alice");

    const adminJar = new CookieJar();
    await signInAs(adminJar, ADMIN_EMAIL, ADMIN_PASSWORD);
    const override = await conversationAction(adminJar, conversationId, "release");
    expect(override.status).toBe(200);
  });

  it("refuses to release an unclaimed conversation", async () => {
    const conversation = await startConversation();
    await ask(conversation, "I need to speak to a human; nothing covers it.");
  await confirmHandoffYes(conversation);
    const aliceJar = new CookieJar();
    await signInAs(aliceJar, ALICE_EMAIL, ALICE_PASSWORD);
    const unclaimed = await conversationAction(aliceJar, conversation.id, "release");
    expect(unclaimed.status).toBe(409);
  });
});

describe("transferring a claim", () => {
  it("hands the conversation to another active admissions advisor with history intact", async () => {
    const { id: conversationId, token } = await claimedConversation();
    const aliceJar = new CookieJar();
    await signInAs(aliceJar, ALICE_EMAIL, ALICE_PASSWORD);
    await conversationAction(aliceJar, conversationId, "reply", { text: "Alice here, taking this over." });

    const transfer = await conversationAction(aliceJar, conversationId, "transfer", {
      to: await staffId(BOB_EMAIL),
    });
    expect(transfer.status).toBe(200);
    const transferred = (await transfer.json()) as { conversation: { state: string; claimedBy: string } };
    expect(transferred.conversation.state).toBe("claimed");
    expect(transferred.conversation.claimedBy).toBe(await staffId(BOB_EMAIL));

    // The new holder can reply; the previous one no longer can.
    const bobJar = new CookieJar();
    await signInAs(bobJar, BOB_EMAIL, BOB_PASSWORD);
    const bobReply = await conversationAction(bobJar, conversationId, "reply", { text: "Bob continuing from here." });
    expect(bobReply.status).toBe(200);
    const aliceReply = await conversationAction(aliceJar, conversationId, "reply", { text: "still alice" });
    expect(aliceReply.status).toBe(409);

    // History preserved for the new holder, and the visitor's own polling
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
    await signInAs(aliceJar, ALICE_EMAIL, ALICE_PASSWORD);

    const selfTarget = await conversationAction(aliceJar, conversationId, "transfer", {
      to: await staffId(ALICE_EMAIL),
    });
    expect(selfTarget.status).toBe(400);

    const unknownTarget = await conversationAction(aliceJar, conversationId, "transfer", {
      to: "no-such-member",
    });
    expect(unknownTarget.status).toBe(400);

    const bobJar = new CookieJar();
    await signInAs(bobJar, BOB_EMAIL, BOB_PASSWORD);
    const notClaimer = await conversationAction(bobJar, conversationId, "transfer", {
      to: await staffId(BOB_EMAIL),
    });
    expect(notClaimer.status).toBe(409);

    // An admin can move the assignment even without holding the claim.
    const adminJar = new CookieJar();
    await signInAs(adminJar, ADMIN_EMAIL, ADMIN_PASSWORD);
    const override = await conversationAction(adminJar, conversationId, "transfer", {
      to: await staffId(BOB_EMAIL),
    });
    expect(override.status).toBe(200);
  });

  it("does not offer a disabled account as a target", async () => {
    const VICTIM_EMAIL = "erin@example.edu";
    const VICTIM_PASSWORD = "erin-disposable-orbit-77";
    await provisionStaff({ email: VICTIM_EMAIL, password: VICTIM_PASSWORD, name: "Erin" });
    const { id: conversationId } = await claimedConversation();
    const adminJar = new CookieJar();
    await signInAs(adminJar, ADMIN_EMAIL, ADMIN_PASSWORD);
    const disable = await membersRequest(adminJar, "POST", `/api/staff/members/${await staffId(VICTIM_EMAIL)}/disable`);
    expect(disable.status).toBe(200);

    const aliceJar = new CookieJar();
    await signInAs(aliceJar, ALICE_EMAIL, ALICE_PASSWORD);
    const disabledTarget = await conversationAction(aliceJar, conversationId, "transfer", {
      to: await staffId(VICTIM_EMAIL),
    });
    expect(disabledTarget.status).toBe(400);
  });
});

describe("the admin role can reply without holding the claim", () => {
  it("lets an admin answer a conversation claimed by someone else", async () => {
    const { id: conversationId } = await claimedConversation();
    const adminJar = new CookieJar();
    await signInAs(adminJar, ADMIN_EMAIL, ADMIN_PASSWORD);
    const reply = await conversationAction(adminJar, conversationId, "reply", {
      text: "Admin stepping in briefly.",
    });
    expect(reply.status).toBe(200);
  });
});

describe("the audit trail", () => {
  it("records claim, reply, transfer, and release with who did it", async () => {
    const { id: conversationId } = await claimedConversation();
    const aliceJar = new CookieJar();
    await signInAs(aliceJar, ALICE_EMAIL, ALICE_PASSWORD);
    await conversationAction(aliceJar, conversationId, "reply", { text: "One answer before I go." });
    await conversationAction(aliceJar, conversationId, "transfer", { to: await staffId(BOB_EMAIL) });

    const bobJar = new CookieJar();
    await signInAs(bobJar, BOB_EMAIL, BOB_PASSWORD);
    await conversationAction(bobJar, conversationId, "release");

    const adminJar = new CookieJar();
    await signInAs(adminJar, ADMIN_EMAIL, ADMIN_PASSWORD);
    const detail = await conversationDetail(adminJar, conversationId);
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

    const eddieJar = new CookieJar();
    await signInAs(eddieJar, EDDIE_EMAIL, EDDIE_PASSWORD);
    const create = await (await import("../src/app/api/staff/answer-rules/route")).POST(
      new Request(`${TEST_ORIGIN}/api/staff/answer-rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: eddieJar.header(), origin: TEST_ORIGIN },
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

    const adminJar = new CookieJar();
    await signInAs(adminJar, ADMIN_EMAIL, ADMIN_PASSWORD);
    const staffRows = (await db.all<{ action: string; detail: string }>(
      "SELECT action, detail FROM audit_log WHERE action IN ('staff_created','staff_disabled')",
    )) as { action: string; detail: string }[];
    expect(staffRows.some((row) => row.action === "staff_created" && row.detail.includes("carol"))).toBe(true);
    expect(staffRows.some((row) => row.action === "staff_disabled" && row.detail.includes("dave"))).toBe(true);
    // A new account's audit row records the stored role value it was created with.
    expect(staffRows.find((row) => row.action === "staff_created" && row.detail?.startsWith("carol"))?.detail)
      .toBe("carol (admissions_advisor)");
  });
});

describe("the relocated password change (ticket 102 decision 2)", () => {
  const read = (rel: string) => readFile(path.join(repoRoot(), rel), "utf8");

  it("is offered from the dashboard chrome, which renders on every page for both roles", async () => {
    const header = await read("src/app/dashboard/header.tsx");
    expect(header).toContain("<PasswordDialog />");
    // The identity block is the chrome's per-member corner: the dialog sits
    // beside sign-out, inside the sidebar both shells render.
    const identityStart = header.indexOf('className={styles.sideIdentity}');
    const identity = header.slice(identityStart, header.indexOf("</div>", identityStart));
    expect(identity).toContain("<PasswordDialog />");
  });

  it("opens a dialog that reuses the self-service change with its no-revocation contract", async () => {
    const dialog = await read("src/app/dashboard/password-dialog.tsx");
    expect(dialog).toContain("Change password");
    expect(dialog).toContain("PasswordSettings");
    // The change goes through the existing auth endpoint (ADR-0006: it
    // revokes no sessions) — pinned where the component always lived.
    const form = await read("src/app/dashboard/settings/password-settings.tsx");
    expect(form).toContain("authClient.changePassword");
    // Admins keep the same control; only an issued reset signs out sessions.
    expect(form).toContain("admin-issued reset");
  });

  it("keeps the Settings page free of the password form", async () => {
    const page = await read("src/app/dashboard/settings/page.tsx");
    expect(page).not.toContain("PasswordSettings");
  });
});

describe("the dashboard front door (ticket 102)", () => {
  it("sends both roles to the inbox; the editor-only Answers redirect is gone", async () => {
    const page = await readFile(path.join(repoRoot(), "src/app/dashboard/page.tsx"), "utf8");
    expect(page).toContain('redirect("/dashboard/inbox")');
    expect(page).not.toContain('"editor"');
    expect(page).not.toContain("/dashboard/answers");
  });
});

describe("the Staff accounts page", () => {
  const read = (rel: string) => readFile(path.join(repoRoot(), rel), "utf8");

  it("is titled Staff accounts and refuses everyone but admins", async () => {
    const page = await read("src/app/dashboard/staff/page.tsx");
    expect(page).toContain('metadata: Metadata = { title: "Staff accounts" }');
    expect(page).toContain('title="Staff accounts"');
    expect(page).toContain('{ roles: ["admin"] }');
    expect(page).toContain("This page requires the admin role.");
  });

  it("labels every account with its role name and status instead of the stored value", async () => {
    const page = await read("src/app/dashboard/staff/page.tsx");
    expect(page).toContain("{member.name} · {staffRoleLabel(member.role)}");
    expect(page).not.toContain("{member.role}");
    for (const status of [">disabled<", ">active<"]) {
      expect(page).toContain(status);
    }
    // Decision 5 fixes the two role names.
    const { staffRoleLabel } = await import("../src/auth/server");
    expect(["admin", "admissions_advisor"].map(staffRoleLabel)).toEqual(["Admin", "Admissions Advisor"]);
  });

  it("creates an Admissions Advisor account with no role picker and no staff or invite wording", async () => {
    const form = await read("src/app/dashboard/staff/account-form.tsx");
    expect(form).toContain("Create an Admissions Advisor account");
    expect(form).not.toContain("<select");
    // The request carries only what the admin fills in.
    expect(form).toContain("JSON.stringify({ name: name.trim(), username, password })");
    // What the page says — every string literal and JSX text, with the
    // module's own imports and the internal API path set aside — names no
    // other role, no invitation, and none of the old vocabulary.
    const source = form.replace(/^import .*$/gm, "").replace(/^"use client";$/m, "");
    const copy = [...source.matchAll(/>([^<>{}]+)<|"([^"]*)"/g)]
      .map((match) => match[1] ?? match[2] ?? "")
      .filter((text) => !text.startsWith("/"))
      .join("\n");
    expect(copy).toContain("Create an Admissions Advisor account");
    expect(copy).not.toMatch(/\brole\b|\binvite|staff|editor|owner|admin/i);
  });
});
