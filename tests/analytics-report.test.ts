import { beforeAll, describe, expect, it } from "vitest";
import { startConversation, startConversationRaw, TEST_CONTACT, ask, TEST_ORIGIN, useTempDatabase, warmChatbotService } from "./helpers";
import {
  CookieJar,
  enrollTotp,
  provisionStaff,
  signInWithTotp,
} from "./auth-helpers";

/**
 * The staff analytics report (ticket 17): period totals and a daily table
 * computed on the server in the reporting time zone, chat and escalation
 * rollups that survive transcript purges, and analytics expiry that runs on
 * its own retention setting independent of transcript retention.
 */

const OWNER_EMAIL = "owner@example.edu";
const OWNER_PASSWORD = "owner-analytics-lantern-64";
const STAFF_EMAIL = "helper@example.edu";
const STAFF_PASSWORD = "helper-analytics-anchor-2b";
const EDITOR_EMAIL = "editor@example.edu";
const EDITOR_PASSWORD = "editor-analytics-orbit-8d";

/** UTC+2, no DST: local day boundaries sit at fixed UTC instants. */
const REPORTING_ZONE = "Etc/GMT-2";

let ownerTotp: Awaited<ReturnType<typeof enrollTotp>>;
let staffTotp: Awaited<ReturnType<typeof enrollTotp>>;
let editorTotp: Awaited<ReturnType<typeof enrollTotp>>;

const ownerJar = new CookieJar();
const staffJar = new CookieJar();
const editorJar = new CookieJar();

interface AnalyticsReport {
  period: string;
  timeZone: string;
  retentionDays: number;
  earliestDay: string;
  days: { day: string; visitors: number; chats: number; escalations: number }[];
  totals: { liveVisitors: number; visitors: number; chats: number; escalations: number };
}

async function getReport(
  jar: CookieJar | null,
  period?: string,
): Promise<Response> {
  const { GET } = await import("../src/app/api/staff/analytics/route");
  const query = period ? `?period=${period}` : "";
  return GET(
    new Request(`${TEST_ORIGIN}/api/staff/analytics${query}`, {
      headers: { ...(jar ? { cookie: jar.header() } : {}) },
    }),
  );
}

async function readReport(jar: CookieJar, period?: string): Promise<AnalyticsReport> {
  const response = await getReport(jar, period);
  expect(response.status).toBe(200);
  return (await response.json()) as AnalyticsReport;
}

async function putAnalyticsSettings(
  jar: CookieJar | null,
  body: unknown,
): Promise<Response> {
  const { PUT } = await import("../src/app/api/staff/settings/analytics/route");
  return PUT(
    new Request(`${TEST_ORIGIN}/api/staff/settings/analytics`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(jar ? { cookie: jar.header() } : {}),
        origin: TEST_ORIGIN,
      },
      body: JSON.stringify(body),
    }),
  );
}

async function putTranscriptRetention(jar: CookieJar, days: number | null): Promise<Response> {
  const { PUT } = await import("../src/app/api/staff/settings/transcript-retention/route");
  return PUT(
    new Request(`${TEST_ORIGIN}/api/staff/settings/transcript-retention`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        cookie: jar.header(),
        origin: TEST_ORIGIN,
      },
      body: JSON.stringify({ days }),
    }),
  );
}

async function seedService() {
  return (await import("../src/db/service")).getChatbotService();
}

/** Day strings relative to today in the configured reporting zone. */
async function dayOffset(offset: number, now: Date): Promise<string> {
  const { reportingDay, addCalendarDays } = await import("../src/domain/analytics");
  return addCalendarDays(reportingDay(REPORTING_ZONE, now), offset);
}

async function postPresenceBeat(browserId: string): Promise<void> {
  const { POST } = await import("../src/app/api/v1/presence/route");
  const response = await POST(
    new Request(`${TEST_ORIGIN}/api/v1/presence`, {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({ browserId }),
    }),
  );
  expect(response.ok).toBe(true);
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
  await signInWithTotp(ownerJar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
  await signInWithTotp(staffJar, STAFF_EMAIL, STAFF_PASSWORD, staffTotp);
  await signInWithTotp(editorJar, EDITOR_EMAIL, EDITOR_PASSWORD, editorTotp);
  // Deterministic zone for day-boundary work (no DST at UTC+2).
  const saved = await putAnalyticsSettings(ownerJar, {
    reportingTimeZone: REPORTING_ZONE,
    retentionDays: 90,
  });
  expect(saved.status).toBe(200);
});

describe("analytics report access and validation", () => {
  it("requires a staff session", async () => {
    expect((await getReport(null)).status).toBe(401);
  });

  it("answers editors with 403 and staff and owners with 200", async () => {
    expect((await getReport(editorJar)).status).toBe(403);
    expect((await getReport(staffJar)).status).toBe(200);
    expect((await getReport(ownerJar)).status).toBe(200);
  });

  it("rejects unknown periods and defaults to 7 days", async () => {
    expect((await getReport(ownerJar, "fortnight")).status).toBe(400);
    // Inherited object keys must not sneak past the period check.
    expect((await getReport(ownerJar, "constructor")).status).toBe(400);
    const report = await readReport(ownerJar);
    expect(report.period).toBe("7d");
    expect(report.timeZone).toBe(REPORTING_ZONE);
    expect(report.days).toHaveLength(7);
  });

  it("answers today with exactly one day", async () => {
    const report = await readReport(ownerJar, "today");
    expect(report.period).toBe("today");
    expect(report.days).toHaveLength(1);
  });

  it("answers 30 days with thirty consecutive zero-filled days", async () => {
    const report = await readReport(ownerJar, "30d");
    expect(report.days).toHaveLength(30);
    const { addCalendarDays } = await import("../src/domain/analytics");
    const days = report.days.map((row) => row.day);
    expect(days[days.length - 1]).toBe(await dayOffset(0, new Date()));
    expect(days[days.length - 2]).toBe(await dayOffset(-1, new Date()));
    for (let index = 1; index < days.length; index += 1) {
      expect(days[index - 1]).toBe(addCalendarDays(days[index]!, -1));
    }
    expect(report.days.every((row) => row.chats === 0 && row.escalations === 0)).toBe(true);
  });
});

describe("day bucketing in the reporting time zone", () => {
  it("maps instants to local days at fixed UTC offsets", async () => {
    const { reportingDay, addCalendarDays, periodDayList } = await import(
      "../src/domain/analytics"
    );
    // 2026-10-28T15:59Z is 17:59 at UTC+2 (same day); local midnight sits at
    // 22:00Z, so 22:00Z is already the 29th there.
    expect(reportingDay(REPORTING_ZONE, new Date("2026-10-28T15:59:00Z"))).toBe("2026-10-28");
    expect(reportingDay(REPORTING_ZONE, new Date("2026-10-28T21:59:00Z"))).toBe("2026-10-28");
    expect(reportingDay(REPORTING_ZONE, new Date("2026-10-28T22:00:00Z"))).toBe("2026-10-29");
    // The default zone per the ticket: Asia/Singapore (UTC+8).
    expect(reportingDay("Asia/Singapore", new Date("2026-10-28T15:59:00Z"))).toBe("2026-10-28");
    expect(reportingDay("Asia/Singapore", new Date("2026-10-28T16:00:00Z"))).toBe("2026-10-29");
    expect(reportingDay("Asia/Singapore", new Date("2026-10-28T16:30:00Z"))).toBe("2026-10-29");
    // Calendar arithmetic rolls months and years without drift.
    expect(addCalendarDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCalendarDays("2027-03-01", -1)).toBe("2027-02-28");
    const today = reportingDay(REPORTING_ZONE, new Date());
    const list = periodDayList(REPORTING_ZONE, 7, new Date());
    expect(list).toHaveLength(7);
    expect(list[list.length - 1]).toBe(today);
  });

  it("counts chats and escalations on the local days they happened", async () => {
    const { store } = await seedService().then((service) => service);
    await store.recordChatCount(await dayOffset(-2, new Date()));
    await store.recordChatCount(await dayOffset(-2, new Date()));
    await store.recordEscalationCount(await dayOffset(-2, new Date()));
    await store.recordChatCount(await dayOffset(0, new Date()));

    const today = await readReport(ownerJar, "today");
    expect(today.totals.chats).toBe(1);
    expect(today.totals.escalations).toBe(0);

    const week = await readReport(ownerJar, "7d");
    expect(week.totals.chats).toBe(3);
    expect(week.totals.escalations).toBe(1);
    const seededDay = await dayOffset(-2, new Date());
    const seeded = week.days.find((row) => row.day === seededDay);
    expect(seeded).toEqual({ day: seededDay, visitors: 0, chats: 2, escalations: 1 });
  });

  it("counts visitors on the local days their beats fell", async () => {
    const { store } = await seedService().then((service) => service);
    const { hashSessionToken } = await import("../src/domain/tokens");
    const now = Date.now();
    const daysAgo5 = new Date(now - 5 * 24 * 60 * 60 * 1000);
    await store.recordAnalyticsPresence(
      hashSessionToken(crypto.randomUUID()),
      daysAgo5.toISOString(),
      await dayOffset(-5, new Date(now)),
    );
    await postPresenceBeat(crypto.randomUUID());

    const today = await readReport(ownerJar, "today");
    expect(today.totals.visitors).toBe(1);
    expect(today.totals.liveVisitors).toBe(1);

    const month = await readReport(ownerJar, "30d");
    expect(month.totals.visitors).toBe(2);
  });
});

describe("real flows drive the rollups", () => {
  it("counts a started chat and its escalation, and a cleared chat's successor", async () => {
    const chatsBefore = (await readReport(ownerJar, "today")).totals.chats;
    const escalationsBefore = (await readReport(ownerJar, "today")).totals.escalations;

    const conversation = await startConversation();
    await ask(conversation, "zzqx no rule matches this wonderwall; speak to a human");

    const afterEscalation = await readReport(ownerJar, "today");
    expect(afterEscalation.totals.chats).toBe(chatsBefore + 1);
    expect(afterEscalation.totals.escalations).toBe(escalationsBefore + 1);

    // The visitor clears: the fresh conversation is a chat created too.
    const { POST } = await import("../src/app/api/v1/conversations/[id]/clear/route");
    const clearResponse = await POST(
      new Request(`${TEST_ORIGIN}/api/v1/conversations/${conversation.id}/clear`, {
        method: "POST",
        headers: { Authorization: `Bearer ${conversation.token}` },
      }),
      { params: Promise.resolve({ id: conversation.id }) },
    );
    expect(clearResponse.status).toBe(200);

    const afterClear = await readReport(ownerJar, "today");
    expect(afterClear.totals.chats).toBe(chatsBefore + 2);
  });

  it("answers a second visitor message in an escalated chat without another escalation", async () => {
    const escalationsBefore = (await readReport(ownerJar, "today")).totals.escalations;
    const conversation = await startConversation();
    await ask(conversation, "zzqx no rule matches this wonderwall; speak to a human");
    await ask(conversation, "still nothing matches this second try zzqx");
    const after = await readReport(ownerJar, "today");
    expect(after.totals.escalations).toBe(escalationsBefore + 1);
  });
});

describe("purge and expiry keep reported history stable", () => {
  it("keeps chat totals when the transcript sweep purges their conversations", async () => {
    const { store, db } = await seedService().then((service) => service);
    const chatsBefore = (await readReport(ownerJar, "today")).totals.chats;

    // A real chat start puts its creation into the daily rollup…
    const startResponse = await startConversationRaw(TEST_CONTACT);
    expect(startResponse.status).toBe(201);
    const { id } = (await startResponse.json()) as { id: string };

    // …then the conversation closes and its closure is backdated past a
    // one-day retention period.
    await store.closeConversation(id);
    const closedBefore = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    await db.run("UPDATE conversations SET closed_at = ? WHERE id = ?", closedBefore, id);

    await putTranscriptRetention(ownerJar, 1);
    // The save above sweeps immediately; the transcript is gone…
    expect(await store.getConversation(id)).toBeNull();
    // …but the reported chat total did not move.
    const after = await readReport(ownerJar, "today");
    expect(after.totals.chats).toBe(chatsBefore + 1);
  });

  it("expires analytics data on its own retention setting when saved", async () => {
    const { store } = await seedService().then((service) => service);
    await store.recordChatCount(await dayOffset(-10, new Date()));
    const saved = await putAnalyticsSettings(ownerJar, {
      reportingTimeZone: REPORTING_ZONE,
      retentionDays: 7,
    });
    expect(saved.status).toBe(200);
    const report = await readReport(ownerJar, "30d");
    expect(report.retentionDays).toBe(7);
    expect(report.earliestDay).toBe(await dayOffset(-6, new Date()));
    const expiredDay = await dayOffset(-10, new Date());
    const expired = report.days.find((row) => row.day === expiredDay);
    expect(expired?.chats ?? 0).toBe(0);
  });

  it("expires analytics on staff traffic even while transcript retention is unconfigured", async () => {
    await putTranscriptRetention(ownerJar, null);
    const { store } = await seedService().then((service) => service);
    // Older than the seven-day analytics window from the previous test, and
    // created after the last sweep ran, so only a fresh sweep can remove it.
    await store.recordChatCount(await dayOffset(-8, new Date()));

    // The report reads what exists: the stale day is still there until staff
    // traffic sweeps it.
    const before = await readReport(ownerJar, "30d");
    const staleDay = await dayOffset(-8, new Date());
    expect(before.days.find((row) => row.day === staleDay)?.chats ?? 0).toBe(1);

    const { GET } = await import("../src/app/api/staff/conversations/route");
    const deskResponse = await GET(
      new Request(`${TEST_ORIGIN}/api/staff/conversations`, {
        headers: { cookie: ownerJar.header() },
      }),
    );
    expect(deskResponse.status).toBe(200);

    const after = await readReport(ownerJar, "30d");
    expect(after.days.find((row) => row.day === staleDay)?.chats ?? 0).toBe(0);
  });
});

describe("analytics settings", () => {
  it("rejects invalid configurations and non-owners", async () => {
    expect(
      (await putAnalyticsSettings(ownerJar, { reportingTimeZone: "Mars/Olympus", retentionDays: 7 })).status,
    ).toBe(400);
    expect(
      (await putAnalyticsSettings(ownerJar, { reportingTimeZone: REPORTING_ZONE, retentionDays: 0 })).status,
    ).toBe(400);
    expect(
      (await putAnalyticsSettings(staffJar, { reportingTimeZone: REPORTING_ZONE, retentionDays: 90 })).status,
    ).toBe(403);
    expect((await putAnalyticsSettings(null, { reportingTimeZone: REPORTING_ZONE, retentionDays: 90 })).status).toBe(
      401,
    );
  });

  it("reads back the effective configuration", async () => {
    const { GET } = await import("../src/app/api/staff/settings/analytics/route");
    const response = await GET(
      new Request(`${TEST_ORIGIN}/api/staff/settings/analytics`, {
        headers: { cookie: ownerJar.header() },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { reportingTimeZone: string; retentionDays: number };
    expect(body).toEqual({ reportingTimeZone: REPORTING_ZONE, retentionDays: 7 });
  });
});
