import { beforeAll, describe, expect, it } from "vitest";
import { ask, startConversation, TEST_ORIGIN,
  warmChatbotService,
} from "./helpers";
import {
  authRequest,
  CookieJar,
  enrollTotp,
  latestOutboxMail,
  provisionStaff,
  signInWithTotp,
  staffApiRequest,
  useTempDatabase,
} from "./auth-helpers";

const STAFF_EMAIL = "registrar@example.edu";
const STAFF_PASSWORD = "correct-horse-battery";
const OWNER_EMAIL = "owner@example.edu";
const OWNER_PASSWORD = "owner-staple-cartoon-42";
const EDITOR_EMAIL = "editor@example.edu";
const EDITOR_PASSWORD = "editor-placid-nimbus-88";

let staffTotp: Awaited<ReturnType<typeof enrollTotp>>;
let ownerTotp: Awaited<ReturnType<typeof enrollTotp>>;

async function escalateAConversation(): Promise<void> {
  const conversation = await startConversation();
  await ask(conversation, "Do you offer helicopter pilot licences?");
}

beforeAll(async () => {
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  useTempDatabase();
  await warmChatbotService();
  // The auth layer only trusts its own base URL: make the synthetic test
  // origin the trusted origin so cookie flows behave like the real dashboard.
    await provisionStaff({ email: OWNER_EMAIL, password: OWNER_PASSWORD, name: "College Owner", role: "owner" });
  await provisionStaff({ email: STAFF_EMAIL, password: STAFF_PASSWORD, name: "Front Desk" });
  await provisionStaff({ email: EDITOR_EMAIL, password: EDITOR_PASSWORD, name: "Content Editor", role: "editor" });
  // Enroll and activate second factors once; later tests sign in with
  // password + TOTP.
  staffTotp = await enrollTotp(new CookieJar(), STAFF_EMAIL, STAFF_PASSWORD);
  ownerTotp = await enrollTotp(new CookieJar(), OWNER_EMAIL, OWNER_PASSWORD);
});

describe("staff authentication gate", () => {
  it("rejects unauthenticated inbox access", async () => {
    const response = await staffApiRequest(new CookieJar(), "/api/staff/conversations");
    expect(response.status).toBe(401);
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
    await db.run('UPDATE "user" SET "emailVerified" = ? WHERE "email" = ?', false, "unverified@example.edu");

    const jar = new CookieJar();
    const response = await authRequest(jar, "/api/auth/sign-in/email", {
      body: { email: "unverified@example.edu", password: "valid-password-123" },
    });
    expect(response.ok).toBe(false);
    const inbox = await staffApiRequest(jar, "/api/staff/conversations");
    expect(inbox.status).toBe(401);
  });

  it("refuses the dashboard until the second factor is enrolled and verified", async () => {
    await provisionStaff({ email: "unenrolled@example.edu", password: "valid-password-123", name: "Unenrolled" });
    const jar = new CookieJar();
    const signIn = await authRequest(jar, "/api/auth/sign-in/email", {
      body: { email: "unenrolled@example.edu", password: "valid-password-123" },
    });
    expect(signIn.ok).toBe(true);

    const inbox = await staffApiRequest(jar, "/api/staff/conversations");
    expect(inbox.status).toBe(403);
    const body = (await inbox.json()) as { error: { code: string } };
    expect(body.error.code).toBe("two_factor_enrollment_required");
  });

  it("rejects wrong passwords with a generic error", async () => {
    const response = await authRequest(null, "/api/auth/sign-in/email", {
      body: { email: STAFF_EMAIL, password: "not-the-password" },
    });
    expect(response.ok).toBe(false);
    const body = (await response.json()) as { message?: string; code?: string };
    expect(JSON.stringify(body)).not.toContain(STAFF_PASSWORD);
  });

  it("rate limits repeated failed sign-ins from one address", async () => {
    const ip = "10.77.7.7";
    let throttled = false;
    for (let i = 0; i < 12; i++) {
      const response = await authRequest(null, "/api/auth/sign-in/email", {
        body: { email: STAFF_EMAIL, password: "not-the-password" },
        ip,
      });
      if (response.status === 429) {
        throttled = true;
        break;
      }
    }
    expect(throttled).toBe(true);
  });
});

describe("protected shared inbox", () => {
  it("lists escalated conversations and their transcripts for verified, two-factor staff", async () => {
    await escalateAConversation();
    const jar = new CookieJar();
    await signInWithTotp(jar, STAFF_EMAIL, STAFF_PASSWORD, staffTotp);

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

  it("refuses the inbox to a role without inbox access", async () => {
    const editorTotp = await enrollTotp(new CookieJar(), EDITOR_EMAIL, EDITOR_PASSWORD);
    const jar = new CookieJar();
    await signInWithTotp(jar, EDITOR_EMAIL, EDITOR_PASSWORD, editorTotp);
    const inbox = await staffApiRequest(jar, "/api/staff/conversations");
    expect(inbox.status).toBe(403);
  });

  it("ends access immediately when the account is disabled", async () => {
    const jar = new CookieJar();
    await signInWithTotp(jar, STAFF_EMAIL, STAFF_PASSWORD, staffTotp);
    const before = await staffApiRequest(jar, "/api/staff/conversations");
    expect(before.status).toBe(200);

    const { getChatbotService } = await import("../src/db/service");
    const { db } = await getChatbotService();
    const userId = (
      (await db.get<{ id: string }>('SELECT "id" FROM "user" WHERE "email" = ?', STAFF_EMAIL)) as {
        id: string;
      }
    ).id;

    // The owner performs the disable through the admin endpoint (the
    // dashboard UI for it arrives in ticket 08).
    const ownerJar = new CookieJar();
    await signInWithTotp(ownerJar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    const ban = await authRequest(ownerJar, "/api/auth/admin/ban-user", {
      body: { userId, banReason: "ticket 02 test" },
    });
    expect(ban.ok).toBe(true);

    const after = await staffApiRequest(jar, "/api/staff/conversations");
    expect(after.status).toBe(401);

    const unban = await authRequest(ownerJar, "/api/auth/admin/unban-user", {
      body: { userId },
    });
    expect(unban.ok).toBe(true);
  });

  it("rejects a signed-out session cookie", async () => {
    const jar = new CookieJar();
    await signInWithTotp(jar, STAFF_EMAIL, STAFF_PASSWORD, staffTotp);
    await authRequest(jar, "/api/auth/sign-out");
    const inbox = await staffApiRequest(jar, "/api/staff/conversations");
    expect(inbox.status).toBe(401);
  });

  it("revokes every session when staff sign out everywhere", async () => {
    const jar = new CookieJar();
    await signInWithTotp(jar, STAFF_EMAIL, STAFF_PASSWORD, staffTotp);
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
    await signInWithTotp(jar, STAFF_EMAIL, STAFF_PASSWORD, staffTotp);
    const { getChatbotService } = await import("../src/db/service");
    const { db } = await getChatbotService();
    await db.run('UPDATE "session" SET "expiresAt" = ?', new Date(Date.now() - 60_000).toISOString());
    const inbox = await staffApiRequest(jar, "/api/staff/conversations");
    expect(inbox.status).toBe(401);
  });
});

describe("password reset", () => {
  it("completes a single-use reset, revokes old sessions, and rejects replay", async () => {
    const resetEmail = "resettable@example.edu";
    const oldPassword = "original-password-123";
    const newPassword = "rotated-password-456";
    await provisionStaff({ email: resetEmail, password: oldPassword, name: "Resettable" });
    const totp = await enrollTotp(new CookieJar(), resetEmail, oldPassword);

    // An active session exists when the reset is requested.
    const jar = new CookieJar();
    await signInWithTotp(jar, resetEmail, oldPassword, totp);

    await authRequest(null, "/api/auth/request-password-reset", { body: { email: resetEmail } });
    const mail = await latestOutboxMail();
    expect(mail.to).toBe(resetEmail);
    const token = /reset-password\/([A-Za-z0-9]+)/.exec(mail.body)?.[1];
    expect(token).toBeTruthy();

    const reset = await authRequest(null, "/api/auth/reset-password", {
      body: { newPassword, token },
    });
    expect(reset.ok).toBe(true);

    // The pre-reset session no longer opens the dashboard.
    const inboxWithOldSession = await staffApiRequest(jar, "/api/staff/conversations");
    expect(inboxWithOldSession.status).toBe(401);

    // The new password signs in (with the second factor as before).
    const freshJar = new CookieJar();
    await signInWithTotp(freshJar, resetEmail, newPassword, totp);
    const inbox = await staffApiRequest(freshJar, "/api/staff/conversations");
    expect(inbox.status).toBe(200);

    // A replayed token is refused.
    const replay = await authRequest(null, "/api/auth/reset-password", {
      body: { newPassword: "replay-password-789", token },
    });
    expect(replay.ok).toBe(false);
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
