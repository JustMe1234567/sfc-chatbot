import { beforeAll, describe, expect, it } from "vitest";
import { TEST_ORIGIN, useTempDatabase, warmChatbotService } from "./helpers";
import {
  authRequest,
  CookieJar,
  provisionStaff,
  signInAs,
} from "./auth-helpers";
import { DEFAULT_WELCOME_MESSAGE, MAX_WELCOME_LENGTH } from "../src/domain/welcome";

const ADMIN_EMAIL = "welcome-owner@example.edu";
const ADMIN_PASSWORD = "welcome-owner-password-1";
const ADVISOR_EMAIL = "welcome-staff@example.edu";
const ADVISOR_PASSWORD = "welcome-staff-password-1";

async function publicWelcome(): Promise<Response> {
  const { GET } = await import("../src/app/api/v1/welcome/route");
  return GET(new Request(`${TEST_ORIGIN}/api/v1/welcome`));
}

async function putWelcome(jar: CookieJar | null, text: unknown): Promise<Response> {
  const { PUT } = await import("../src/app/api/staff/settings/welcome/route");
  // A write always carries the trusted dashboard origin (the CSRF guard
  // rejects origin-less writes before auth even runs), so an origin-bearing
  // anonymous request isolates the 401 the auth layer owes a stranger.
  return PUT(
    new Request(`${TEST_ORIGIN}/api/staff/settings/welcome`, {
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

async function getStaffWelcome(jar: CookieJar): Promise<Response> {
  const { GET } = await import("../src/app/api/staff/settings/welcome/route");
  return GET(
    new Request(`${TEST_ORIGIN}/api/staff/settings/welcome`, {
      headers: { cookie: jar.header() },
    }),
  );
}

beforeAll(async () => {
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  useTempDatabase();
  await warmChatbotService();
  await provisionStaff({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: "Owner", role: "admin" });
  await provisionStaff({ email: ADVISOR_EMAIL, password: ADVISOR_PASSWORD, name: "Editor Staff",  });
});

describe("public welcome endpoint", () => {
  it("serves the default copy with no credentials while unconfigured", async () => {
    const response = await publicWelcome();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { text: string };
    expect(body.text).toBe(DEFAULT_WELCOME_MESSAGE);
  });

  it("serves the published copy so dashboard edits reach the next widget open", async () => {
    const jar = new CookieJar();
    await signInAs(jar, ADMIN_EMAIL, ADMIN_PASSWORD);
    const published = "Welcome to Springfield College — ask us anything about campus life.";
    const put = await putWelcome(jar, published);
    expect(put.status).toBe(200);
    expect(((await put.json()) as { text: string }).text).toBe(published);

    const after = await publicWelcome();
    expect(((await after.json()) as { text: string }).text).toBe(published);
  });
});

describe("welcome setting management", () => {
  it("lets the owner read the currently published text from the dashboard", async () => {
    const jar = new CookieJar();
    await signInAs(jar, ADMIN_EMAIL, ADMIN_PASSWORD);
    const response = await getStaffWelcome(jar);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { text: string }).text.length).toBeGreaterThan(0);
  });

  it("rejects empty, whitespace, oversized, and missing copy", async () => {
    const jar = new CookieJar();
    await signInAs(jar, ADMIN_EMAIL, ADMIN_PASSWORD);
    for (const bad of ["", "   ", "x".repeat(MAX_WELCOME_LENGTH + 1), null, 42]) {
      const response = await putWelcome(jar, bad);
      expect(response.status).toBe(400);
    }
  });

  it("rejects unauthenticated updates; both dashboard roles may publish", async () => {
    const anonymous = await putWelcome(null, "No session");
    expect(anonymous.status).toBe(401);

    // Ticket 102: the welcome message is chatbot content in the Answers
    // area, so the admissions advisor publishes it like the admin.
    const jar = new CookieJar();
    await signInAs(jar, ADVISOR_EMAIL, ADVISOR_PASSWORD);
    const advisorPut = await putWelcome(jar, "Published by an admissions advisor");
    expect(advisorPut.status).toBe(200);
    expect((await getStaffWelcome(jar)).status).toBe(200);
  });
});
