import { beforeAll, describe, expect, it } from "vitest";
import { TEST_ORIGIN, useTempDatabase, warmChatbotService } from "./helpers";
import {
  authRequest,
  CookieJar,
  provisionStaff,
  signInAs,
} from "./auth-helpers";
import { DEFAULT_WAITING_NOTICE, MAX_WAITING_NOTICE_LENGTH } from "../src/domain/waitingNotice";

const ADMIN_EMAIL = "notice-admin@example.edu";
const ADMIN_PASSWORD = "notice-admin-password-1";
const ADVISOR_EMAIL = "notice-advisor@example.edu";
const ADVISOR_PASSWORD = "notice-advisor-password-1";

async function publicWaitingNotice(): Promise<Response> {
  const { GET } = await import("../src/app/api/v1/waiting-notice/route");
  return GET(new Request(`${TEST_ORIGIN}/api/v1/waiting-notice`));
}

async function putWaitingNotice(jar: CookieJar | null, text: unknown): Promise<Response> {
  const { PUT } = await import("../src/app/api/staff/settings/waiting-notice/route");
  // A write always carries the trusted dashboard origin (the CSRF guard
  // rejects origin-less writes before auth even runs), so an origin-bearing
  // anonymous request isolates the 401 the auth layer owes a stranger.
  return PUT(
    new Request(`${TEST_ORIGIN}/api/staff/settings/waiting-notice`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        origin: TEST_ORIGIN,
        ...(jar ? { cookie: jar.header() } : {}),
      },
      body: JSON.stringify({ text }),
    }),
  );
}

async function getStaffWaitingNotice(jar: CookieJar): Promise<Response> {
  const { GET } = await import("../src/app/api/staff/settings/waiting-notice/route");
  return GET(
    new Request(`${TEST_ORIGIN}/api/staff/settings/waiting-notice`, {
      headers: { cookie: jar.header() },
    }),
  );
}

beforeAll(async () => {
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  useTempDatabase();
  await warmChatbotService();
  await provisionStaff({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: "Admin", role: "admin" });
  await provisionStaff({ email: ADVISOR_EMAIL, password: ADVISOR_PASSWORD, name: "Advisor Staff" });
});

describe("public waiting-notice endpoint", () => {
  it("serves the default copy with no credentials while unconfigured", async () => {
    const response = await publicWaitingNotice();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { text: string };
    expect(body.text).toBe(DEFAULT_WAITING_NOTICE);
  });

  it("serves the published copy so dashboard edits reach the next widget open", async () => {
    const jar = new CookieJar();
    await signInAs(jar, ADMIN_EMAIL, ADMIN_PASSWORD);
    const published = "An admissions advisor will be with you shortly.";
    const put = await putWaitingNotice(jar, published);
    expect(put.status).toBe(200);
    expect(((await put.json()) as { text: string }).text).toBe(published);

    const after = await publicWaitingNotice();
    expect(((await after.json()) as { text: string }).text).toBe(published);
  });
});

describe("waiting-notice setting management", () => {
  it("lets the admin read the currently published text from the dashboard", async () => {
    const jar = new CookieJar();
    await signInAs(jar, ADMIN_EMAIL, ADMIN_PASSWORD);
    const response = await getStaffWaitingNotice(jar);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { text: string }).text.length).toBeGreaterThan(0);
  });

  it("rejects empty, whitespace, oversized, and missing copy", async () => {
    const jar = new CookieJar();
    await signInAs(jar, ADMIN_EMAIL, ADMIN_PASSWORD);
    for (const bad of ["", "   ", "x".repeat(MAX_WAITING_NOTICE_LENGTH + 1), null, 42]) {
      const response = await putWaitingNotice(jar, bad);
      expect(response.status).toBe(400);
    }
    // A rejected save never replaces the published value.
    const after = await publicWaitingNotice();
    expect(((await after.json()) as { text: string }).text).toBe(
      "An admissions advisor will be with you shortly.",
    );
  });

  it("rejects unauthenticated updates; both dashboard roles may publish", async () => {
    const anonymous = await putWaitingNotice(null, "No session");
    expect(anonymous.status).toBe(401);

    // Ticket 102: the waiting notice is chatbot content in the Answers
    // area, so the admissions advisor publishes it like the admin.
    const jar = new CookieJar();
    await signInAs(jar, ADVISOR_EMAIL, ADVISOR_PASSWORD);
    const advisorPut = await putWaitingNotice(jar, "Staff will reply soon.");
    expect(advisorPut.status).toBe(200);
    expect((await getStaffWaitingNotice(jar)).status).toBe(200);
  });
});
