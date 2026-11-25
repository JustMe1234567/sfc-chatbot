import { beforeAll, describe, expect, it } from "vitest";
import { ask, confirmHandoffYes, startConversation, TEST_ORIGIN,
  warmChatbotService,
} from "./helpers";
import {
  authRequest,
  CookieJar,
  provisionStaff,
  staffApiRequest,
  useTempDatabase,
  signInAs,
} from "./auth-helpers";
import { expireFakeSessions, registerFakeStaff } from "./fake-auth-provider";

const STAFF_EMAIL = "registrar@example.edu";
const STAFF_PASSWORD = "correct-horse-battery";
const ADMIN_EMAIL = "owner@example.edu";
const ADMIN_PASSWORD = "owner-staple-cartoon-42";
const ADVISOR_EMAIL = "editor@example.edu";
const ADVISOR_PASSWORD = "editor-placid-nimbus-88";

async function escalateAConversation(): Promise<void> {
  const conversation = await startConversation();
  await ask(conversation, "Do you offer helicopter pilot licences? I need to speak to a human.");
  await confirmHandoffYes(conversation);
}

beforeAll(async () => {
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  useTempDatabase();
  await warmChatbotService();
  // The auth layer only trusts its own base URL: make the synthetic test
  // origin the trusted origin so cookie flows behave like the real dashboard.
    await provisionStaff({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: "College Admin", role: "admin" });
  await provisionStaff({ email: STAFF_EMAIL, password: STAFF_PASSWORD, name: "Front Desk" });
  await provisionStaff({ email: ADVISOR_EMAIL, password: ADVISOR_PASSWORD, name: "Content Advisor",  });
  // Password-only sign-in throughout (ticket 82 removed the second factor).
});

describe("staff authentication gate", () => {
  it("rejects unauthenticated inbox access", async () => {
    const response = await staffApiRequest(new CookieJar(), "/api/staff/conversations");
    expect(response.status).toBe(401);
  });

  it("rejects forged session cookies", async () => {
    const { GET } = await import("../src/app/api/staff/conversations/route");
    const response = await GET(
      new Request(`${TEST_ORIGIN}/api/staff/conversations`, {
        headers: { cookie: "sfc_test_auth=forged" },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("does not grant dashboard access to an Auth user without a staff record", async () => {
    registerFakeStaff({
      userId: crypto.randomUUID(),
      username: "unknown-auth-user",
      name: "Unknown",
      password: "unknown-user-password-42",
    });
    const response = await authRequest(new CookieJar(), "/api/auth/sign-in/username", {
      body: { username: "unknown-auth-user", password: "unknown-user-password-42" },
    });
    expect(response.status).toBe(401);
  });

  it("blocks cross-origin authentication mutations", async () => {
    const { POST } = await import("../src/app/api/auth/[...all]/route");
    const response = await POST(
      new Request(`${TEST_ORIGIN}/api/auth/sign-in/username`, {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: "https://evil.example" },
        body: JSON.stringify({ username: "registrar", password: STAFF_PASSWORD }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("keeps public sign-up closed", async () => {
    const response = await authRequest(null, "/api/auth/sign-up/email", {
      body: { email: "intruder@example.edu", password: "intruder-password-1", name: "Intruder" },
    });
    expect(response.ok).toBe(false);
  });

  it("blocks sign-in for an unverified staff account", async () => {
    await provisionStaff({ email: "unverified@example.edu", password: "valid-password-123", name: "Unverified" });
    const { getChatbotService } = await import("../src/db/service");
    const { db } = await getChatbotService();
    await db.run('UPDATE staff_members SET "emailVerified" = ? WHERE "username" = ?', false, "unverified");

    const jar = new CookieJar();
    const response = await authRequest(jar, "/api/auth/sign-in/username", {
      body: { username: "unverified", password: "valid-password-123" },
    });
    expect(response.ok).toBe(false);
    const inbox = await staffApiRequest(jar, "/api/staff/conversations");
    expect(inbox.status).toBe(401);
  });

  it("admits password-only sign-in to the dashboard (ticket 82 removed the second factor)", async () => {
    await provisionStaff({ email: "unenrolled@example.edu", password: "valid-password-123", name: "Unenrolled" });
    const jar = new CookieJar();
    const signIn = await authRequest(jar, "/api/auth/sign-in/username", {
      body: { username: "unenrolled", password: "valid-password-123" },
    });
    expect(signIn.ok).toBe(true);

    // No enrollment stage stands between the credential check and the
    // inbox; ticket 81's login log and IP block are the compensating
    // controls.
    const inbox = await staffApiRequest(jar, "/api/staff/conversations");
    expect(inbox.status).toBe(200);
  });

  it("rejects wrong passwords with a generic error", async () => {
    const response = await authRequest(null, "/api/auth/sign-in/username", {
      body: { username: "registrar", password: "not-the-password" },
    });
    expect(response.ok).toBe(false);
    const body = (await response.json()) as { message?: string; code?: string };
    expect(JSON.stringify(body)).not.toContain(STAFF_PASSWORD);
  });

  it("blocks an IP after ten unknown-username failures and still admits valid staff (ticket 81)", { timeout: 120_000 }, async () => {
    const ip = "10.77.7.7";
    for (let i = 0; i < 10; i++) {
      const response = await authRequest(null, "/api/auth/sign-in/username", {
        body: { username: "no-such-staff", password: "not-the-password" },
        ip,
      });
      expect(response.status).toBe(401);
    }
    // The eleventh attempt is rejected by the block — with the same generic
    // body as any failure, so the status tells the attacker nothing new.
    const blocked = await authRequest(null, "/api/auth/sign-in/username", {
      body: { username: "no-such-staff", password: "not-the-password" },
      ip,
    });
    expect(blocked.status).toBe(401);
    const blockedBody = (await blocked.json()) as { error?: { message?: string } };
    expect(blockedBody.error?.message).toBe("Username or password is incorrect.");

    const { getChatbotService } = await import("../src/db/service");
    const { db } = await getChatbotService();
    const events = await db.all<{ outcome: string; reason: string }>(
      "SELECT outcome, reason FROM login_events WHERE ip = ? ORDER BY created_at, id",
      ip,
    );
    // Ten ordinary failures, then the eleventh attempt rejected by the
    // block (same-millisecond rows make row order unstable, so the blocked
    // attempt is asserted as its own subset).
    expect(events.filter((event) => event.outcome === "failure")).toHaveLength(10);
    const blockedEvents = events.filter((event) => event.outcome === "blocked");
    expect(blockedEvents).toHaveLength(1);
    expect(blockedEvents[0]?.reason).toBe("ip_blocked");

    // The carve-out: a valid username with the correct password signs in
    // from the blocked IP mid-block.
    const jar = new CookieJar();
    const success = await authRequest(jar, "/api/auth/sign-in/username", {
      body: { username: "registrar", password: STAFF_PASSWORD },
      ip,
    });
    expect(success.ok).toBe(true);
  });
});

describe("protected shared inbox", () => {
  it("lists escalated conversations and their transcripts for verified staff", async () => {
    await escalateAConversation();
    const jar = new CookieJar();
    await signInAs(jar, STAFF_EMAIL, STAFF_PASSWORD);

    const inbox = await staffApiRequest(jar, "/api/staff/conversations");
    expect(inbox.status).toBe(200);
    const body = (await inbox.json()) as {
      incoming: { id: string; state: string; messageCount: number; lastMessage: { text: string } | null }[];
      active: unknown[];
    };
    expect(body.incoming.length).toBeGreaterThanOrEqual(1);
    // The desk's Incoming section is the old waiting-only inbox: escalations.
    expect(body.incoming.every((item) => item.state === "awaiting_staff")).toBe(true);

    const first = body.incoming[0]!;
    const transcript = await staffApiRequest(jar, `/api/staff/conversations/${first.id}`);
    expect(transcript.status).toBe(200);
    const transcriptBody = (await transcript.json()) as {
      conversation: { state: string };
      messages: { role: string }[];
    };
    expect(transcriptBody.conversation.state).toBe("awaiting_staff");
    expect(transcriptBody.messages.map((message) => message.role)).toContain("visitor");
  });

  it("gives the inbox to both roles — the ticket-102 merge left no answer-only role", async () => {
    const jar = new CookieJar();
    await signInAs(jar, ADVISOR_EMAIL, ADVISOR_PASSWORD);
    const inbox = await staffApiRequest(jar, "/api/staff/conversations");
    expect(inbox.status).toBe(200);
  });

  it("ends access immediately when the account is disabled", async () => {
    const jar = new CookieJar();
    await signInAs(jar, STAFF_EMAIL, STAFF_PASSWORD);
    const before = await staffApiRequest(jar, "/api/staff/conversations");
    expect(before.status).toBe(200);

    const { getChatbotService } = await import("../src/db/service");
    const { db } = await getChatbotService();
    await db.run('UPDATE staff_members SET "banned" = ? WHERE "username" = ?', true, "registrar");

    const after = await staffApiRequest(jar, "/api/staff/conversations");
    expect(after.status).toBe(401);
    await db.run('UPDATE staff_members SET "banned" = ? WHERE "username" = ?', false, "registrar");
  });

  it("rejects a signed-out session cookie", async () => {
    const jar = new CookieJar();
    await signInAs(jar, STAFF_EMAIL, STAFF_PASSWORD);
    await authRequest(jar, "/api/auth/sign-out");
    const inbox = await staffApiRequest(jar, "/api/staff/conversations");
    expect(inbox.status).toBe(401);
  });

  it("revokes every session when staff sign out everywhere", async () => {
    const jar = new CookieJar();
    await signInAs(jar, STAFF_EMAIL, STAFF_PASSWORD);
    const { POST } = await import("../src/app/api/staff/sessions/revoke-all/route");

    const sameOrigin = await POST(
      new Request("http://chatbot.test/api/staff/sessions/revoke-all", {
        method: "POST",
        headers: { cookie: jar.header(), origin: TEST_ORIGIN },
      }),
    );
    expect(sameOrigin.status).toBe(200);

    const inbox = await staffApiRequest(jar, "/api/staff/conversations");
    expect(inbox.status).toBe(401);
  });

  it("rejects an expired session", async () => {
    const jar = new CookieJar();
    await signInAs(jar, STAFF_EMAIL, STAFF_PASSWORD);
    expireFakeSessions(STAFF_EMAIL);
    const inbox = await staffApiRequest(jar, "/api/staff/conversations");
    expect(inbox.status).toBe(401);
  });
});

describe("staff mutation CSRF protection", () => {
  it("blocks unsafe requests without a trusted Origin header", async () => {
    const { sameOriginGuard } = await import("../src/api/staff");
    const foreign = new Request("http://chatbot.test/api/staff/conversations", {
      method: "POST",
      headers: { origin: "https://evil.example.net" },
    });
    expect(sameOriginGuard(foreign)?.status).toBe(403);

    const missing = new Request("http://chatbot.test/api/staff/conversations", { method: "POST" });
    expect(sameOriginGuard(missing)?.status).toBe(403);

    const trusted = new Request("http://chatbot.test/api/staff/sessions/revoke-all", {
      method: "POST",
      headers: { origin: TEST_ORIGIN },
    });
    expect(sameOriginGuard(trusted)).toBeNull();

    const safe = new Request("http://chatbot.test/api/staff/conversations");
    expect(sameOriginGuard(safe)).toBeNull();
  });
});
