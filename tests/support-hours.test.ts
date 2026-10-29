import { beforeAll, describe, expect, it } from "vitest";
import { ask, startConversation, TEST_ORIGIN, useTempDatabase, warmChatbotService } from "./helpers";
import {
  CookieJar,
  enrollTotp,
  provisionStaff,
  signInWithTotp,
} from "./auth-helpers";

const OWNER_EMAIL = "owner@example.edu";
const OWNER_PASSWORD = "owner-hours-lantern-64";
const STAFF_EMAIL = "helper@example.edu";
const STAFF_PASSWORD = "helper-hours-anchor-2b";
const EDITOR_EMAIL = "editor@example.edu";
const EDITOR_PASSWORD = "editor-hours-orbit-8d";

let ownerTotp: Awaited<ReturnType<typeof enrollTotp>>;
let staffTotp: Awaited<ReturnType<typeof enrollTotp>>;
let editorTotp: Awaited<ReturnType<typeof enrollTotp>>;

/** Monday–Friday 09:00–17:00 at UTC+2 (Etc/GMT-2 has no DST: deterministic). */
const WEEKDAY_HOURS = {
  timeZone: "Etc/GMT-2",
  days: [1, 2, 3, 4, 5],
  startMinute: 9 * 60,
  endMinute: 17 * 60,
};

async function putHours(jar: CookieJar | null, hours: unknown, origin = TEST_ORIGIN): Promise<Response> {
  const { PUT } = await import("../src/app/api/staff/settings/support-hours/route");
  return PUT(
    new Request(`${TEST_ORIGIN}/api/staff/settings/support-hours`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(jar ? { cookie: jar.header() } : {}),
        origin,
      },
      body: JSON.stringify({ hours }),
    }),
  );
}

async function getHours(jar: CookieJar): Promise<{ hours: typeof WEEKDAY_HOURS | null }> {
  const { GET } = await import("../src/app/api/staff/settings/support-hours/route");
  const response = await GET(
    new Request(`${TEST_ORIGIN}/api/staff/settings/support-hours`, {
      headers: { cookie: jar.header() },
    }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as { hours: typeof WEEKDAY_HOURS | null };
}

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await warmChatbotService();
  await provisionStaff({ email: OWNER_EMAIL, password: OWNER_PASSWORD, name: "Olive", role: "owner" });
  await provisionStaff({ email: STAFF_EMAIL, password: STAFF_PASSWORD, name: "Sam" });
  await provisionStaff({ email: EDITOR_EMAIL, password: EDITOR_PASSWORD, name: "Eddie", role: "editor" });
  ownerTotp = await enrollTotp(new CookieJar(), OWNER_EMAIL, OWNER_PASSWORD);
  staffTotp = await enrollTotp(new CookieJar(), STAFF_EMAIL, STAFF_PASSWORD);
  editorTotp = await enrollTotp(new CookieJar(), EDITOR_EMAIL, EDITOR_PASSWORD);
});

describe("support-hours membership across day boundaries and zones", () => {
  it("tells inside from outside at the start, end, and day edges", async () => {
    const { isWithinSupportHours } = await import("../src/domain/hours");
    // 2026-10-26 is a Monday.
    expect(isWithinSupportHours(WEEKDAY_HOURS, new Date("2026-10-26T06:59:00Z"))).toBe(false); // 08:59 local
    expect(isWithinSupportHours(WEEKDAY_HOURS, new Date("2026-10-26T07:00:00Z"))).toBe(true); // 09:00 local, inclusive start
    expect(isWithinSupportHours(WEEKDAY_HOURS, new Date("2026-10-26T14:59:00Z"))).toBe(true); // 16:59 local
    expect(isWithinSupportHours(WEEKDAY_HOURS, new Date("2026-10-26T15:00:00Z"))).toBe(false); // 17:00 local, exclusive end
    // The same instant can land on a different local day across a boundary:
    // Sunday 22:30Z is Monday 00:30 at UTC+2 (before opening), and Monday
    // 10:30 at UTC+12 (inside, Monday).
    expect(isWithinSupportHours(WEEKDAY_HOURS, new Date("2026-10-25T22:30:00Z"))).toBe(false);
    expect(isWithinSupportHours(
      { ...WEEKDAY_HOURS, timeZone: "Etc/GMT-12" },
      new Date("2026-10-25T22:30:00Z"),
    )).toBe(true);
    // Closed day: Saturday morning is out even inside the clock window.
    expect(isWithinSupportHours(WEEKDAY_HOURS, new Date("2026-10-24T10:00:00Z"))).toBe(false);
  });

  it("summarizes the schedule readably", async () => {
    const { scheduleSummary } = await import("../src/domain/hours");
    expect(scheduleSummary(WEEKDAY_HOURS)).toBe(
      "Monday to Friday, 09:00–17:00 (Etc/GMT-2)",
    );
    expect(scheduleSummary({ ...WEEKDAY_HOURS, days: [0, 1, 2, 3, 4, 5, 6] })).toBe(
      "every day, 09:00–17:00 (Etc/GMT-2)",
    );
    expect(scheduleSummary({ ...WEEKDAY_HOURS, days: [2, 4, 6] })).toBe(
      "Tuesday, Thursday, Saturday, 09:00–17:00 (Etc/GMT-2)",
    );
  });

  it("words the handoff by the clock without inventing promises", async () => {
    const { handoffReply } = await import("../src/domain/hours");
    const inside = handoffReply(WEEKDAY_HOURS, new Date("2026-10-26T10:00:00Z"));
    expect(inside).toContain("handed our conversation to the college staff");
    expect(inside).toContain("on duty until 17:00 (Etc/GMT-2)");

    const outside = handoffReply(WEEKDAY_HOURS, new Date("2026-10-24T10:00:00Z"));
    expect(outside).toContain("handed our conversation to the college staff");
    expect(outside).toContain("Monday to Friday, 09:00–17:00 (Etc/GMT-2)");
    expect(outside).toContain("when the desk is open");

    const unconfigured = handoffReply(null, new Date("2026-10-26T10:00:00Z"));
    expect(unconfigured).toContain("handed our conversation to the college staff");
    expect(unconfigured).not.toContain("on duty");
    expect(unconfigured).not.toContain("desk");
  });
});

describe("the owner configures support hours", () => {
  it("sets, changes, and clears them", async () => {
    const ownerJar = new CookieJar();
    await signInWithTotp(ownerJar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);

    const saved = await putHours(ownerJar, WEEKDAY_HOURS);
    expect(saved.status).toBe(200);
    expect((await getHours(ownerJar)).hours).toEqual(WEEKDAY_HOURS);

    const changed = await putHours(ownerJar, { ...WEEKDAY_HOURS, endMinute: 16 * 60 });
    expect(changed.status).toBe(200);
    expect((await getHours(ownerJar)).hours).toEqual({ ...WEEKDAY_HOURS, endMinute: 16 * 60 });

    const cleared = await putHours(ownerJar, null);
    expect(cleared.status).toBe(200);
    expect((await getHours(ownerJar)).hours).toBeNull();
  });

  it("rejects malformed configurations", async () => {
    const ownerJar = new CookieJar();
    await signInWithTotp(ownerJar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);

    for (const bad of [
      { ...WEEKDAY_HOURS, timeZone: "Not/AZone" },
      { ...WEEKDAY_HOURS, days: [7] },
      { ...WEEKDAY_HOURS, days: [1, 1, 2] },
      { ...WEEKDAY_HOURS, startMinute: 17 * 60, endMinute: 9 * 60 },
      { ...WEEKDAY_HOURS, startMinute: -1 },
      { ...WEEKDAY_HOURS, endMinute: 1441 },
      { ...WEEKDAY_HOURS, days: "monday" as unknown as number[] },
    ]) {
      const response = await putHours(ownerJar, bad);
      expect(response.status).toBe(400);
    }
  });

  it("is owner-only and origin-checked", async () => {
    const staffJar = new CookieJar();
    await signInWithTotp(staffJar, STAFF_EMAIL, STAFF_PASSWORD, staffTotp);
    expect((await putHours(staffJar, WEEKDAY_HOURS)).status).toBe(403);

    const editorJar = new CookieJar();
    await signInWithTotp(editorJar, EDITOR_EMAIL, EDITOR_PASSWORD, editorTotp);
    expect((await putHours(editorJar, WEEKDAY_HOURS)).status).toBe(403);

    const ownerJar = new CookieJar();
    await signInWithTotp(ownerJar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    expect((await putHours(ownerJar, WEEKDAY_HOURS, "https://evil.example.net")).status).toBe(403);
    expect((await putHours(null, WEEKDAY_HOURS)).status).toBe(401);
  });
});

describe("the visitor's handoff wording follows the configuration", () => {
  it("treats a corrupt stored configuration as unconfigured", async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { db } = await getChatbotService();
    await db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES ('support_hours', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      JSON.stringify({ timeZone: "Not/AZone", days: [1], startMinute: 0, endMinute: 60 }),
      new Date().toISOString(),
    );
    const ownerJar = new CookieJar();
    await signInWithTotp(ownerJar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    expect((await getHours(ownerJar)).hours).toBeNull();

    const conversation = await startConversation();
    const response = await ask(conversation, "Nothing covers this question either.");
    const body = (await response.json()) as { reply: { text: string } };
    expect(body.reply.text).toContain("handed our conversation to the college staff");
    expect(body.reply.text).not.toContain("Not/AZone");
    await db.run("DELETE FROM settings WHERE key = 'support_hours'");
  });

  it("uses the general message while unconfigured, schedule wording once set", async () => {
    // Unconfigured first: the wording makes no response-time promise.
    const before = await startConversation();
    const beforeReply = await ask(before, "What astrological sign is the college mascot?");
    const beforeBody = (await beforeReply.json()) as { reply: { text: string } };
    expect(beforeBody.reply.text).toContain("handed our conversation to the college staff");
    expect(beforeBody.reply.text).not.toContain("on duty");

    // Always-open hours (all days, 00:00–24:00) make the on-duty wording
    // deterministic regardless of when the test runs.
    const ownerJar = new CookieJar();
    await signInWithTotp(ownerJar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    const saved = await putHours(ownerJar, {
      timeZone: "Etc/GMT-2",
      days: [0, 1, 2, 3, 4, 5, 6],
      startMinute: 0,
      endMinute: 24 * 60,
    });
    expect(saved.status).toBe(200);

    const after = await startConversation();
    const afterReply = await ask(after, "Do you offer hot air balloon parking?");
    const afterBody = (await afterReply.json()) as { reply: { text: string } };
    expect(afterBody.reply.text).toContain("on duty");
    expect(afterBody.reply.text).toContain("Etc/GMT-2");

    // Clearing returns the promise-free general message.
    await putHours(ownerJar, null);
    const cleared = await startConversation();
    const clearedReply = await ask(cleared, "Please tell me about the campus cheese cellar.");
    const clearedBody = (await clearedReply.json()) as { reply: { text: string } };
    expect(clearedBody.reply.text).toContain("handed our conversation to the college staff");
    expect(clearedBody.reply.text).not.toContain("on duty");
  });
});
