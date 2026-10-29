import type { AppDatabase } from "../db/appDatabase";
import type { Store } from "./types";
import {
  getAnalyticsRetentionDays,
  getReportingTimeZone,
} from "../settings";
import { envMs } from "./limits";

/**
 * Visitor and chat analytics (ticket 17). Aggregates only: browsers are
 * counted from an anonymous client-generated identifier, chats and
 * escalations from daily rollup rows that survive transcript purges. Nothing
 * here reads message text, emails, IP addresses, or staff identities.
 */

/** A browser is "live" while a beat arrived inside this window. */
const LIVE_WINDOW_MS = 2 * 60 * 1000;

export function analyticsLiveWindowMs(): number {
  // ANALYTICS_LIVE_WINDOW_MS lets tests shrink the window so liveness is
  // deterministic regardless of machine speed. Production keeps two minutes.
  return envMs("ANALYTICS_LIVE_WINDOW_MS", LIVE_WINDOW_MS);
}

export type AnalyticsPeriod = "today" | "7d" | "30d";

export const ANALYTICS_PERIOD_DAY_COUNT: Record<AnalyticsPeriod, number> = {
  today: 1,
  "7d": 7,
  "30d": 30,
};

export interface AnalyticsDayRow {
  day: string;
  visitors: number;
  chats: number;
  escalations: number;
}

export interface AnalyticsReport {
  period: AnalyticsPeriod;
  timeZone: string;
  retentionDays: number;
  /** First day the retention window still covers; older data is gone. */
  earliestDay: string;
  days: AnalyticsDayRow[];
  totals: {
    liveVisitors: number;
    visitors: number;
    chats: number;
    escalations: number;
  };
}

function isoDayParts(timeZone: string, at: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "01";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** The reporting day 'YYYY-MM-DD' an instant falls on in a time zone. */
export function reportingDay(timeZone: string, at: Date): string {
  return isoDayParts(timeZone, at);
}

/**
 * Pure calendar arithmetic on day strings: immune to DST because it never
 * touches an instant. Rolls months and years correctly.
 */
export function addCalendarDays(day: string, offset: number): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) {
    return day;
  }
  const shifted = new Date(Date.UTC(year, month - 1, date + offset));
  return isoDayParts("UTC", shifted);
}

/** The period's days, oldest first, ending with today in the zone. */
export function periodDayList(timeZone: string, count: number, now: Date): string[] {
  const today = reportingDay(timeZone, now);
  const days: string[] = [];
  for (let offset = -(count - 1); offset <= 0; offset += 1) {
    days.push(addCalendarDays(today, offset));
  }
  return days;
}

/**
 * The presence beat (ticket 17): buckets the beat into the reporting day it
 * arrived in and stores it against the hashed browser identifier. The
 * instant is the server's — clients never supply timestamps.
 */
export async function recordAnalyticsPresence(
  db: AppDatabase,
  store: Store,
  visitorHash: string,
  at: Date,
): Promise<void> {
  await store.recordAnalyticsPresence(
    visitorHash,
    at.toISOString(),
    reportingDay(await getReportingTimeZone(db), at),
  );
}

/**
 * The chat rollup for the reporting day a conversation was created in.
 * Called from every path that mints a conversation row, so purged
 * transcripts leave their already-counted totals untouched.
 */
export async function recordChatStarted(db: AppDatabase, store: Store, at: Date): Promise<void> {
  await store.recordChatCount(reportingDay(await getReportingTimeZone(db), at));
}

/** The escalation rollup for the reporting day a handoff was raised in. */
export async function recordEscalation(db: AppDatabase, store: Store, at: Date): Promise<void> {
  await store.recordEscalationCount(reportingDay(await getReportingTimeZone(db), at));
}

/**
 * The server-computed report behind the dashboard page: period totals, the
 * live snapshot (independent of the period), and the zero-filled daily
 * table. Aggregate queries only — no transcripts or visitor identifiers
 * ever reach the browser.
 */
export async function buildAnalyticsReport(
  store: Store,
  options: {
    timeZone: string;
    retentionDays: number;
    period: AnalyticsPeriod;
    now: Date;
  },
): Promise<AnalyticsReport> {
  const { timeZone, retentionDays, period, now } = options;
  const count = ANALYTICS_PERIOD_DAY_COUNT[period];
  const days = periodDayList(timeZone, count, now);
  const overview = await store.analyticsOverview({
    liveCutoff: new Date(now.getTime() - analyticsLiveWindowMs()).toISOString(),
    startDay: days[0]!,
    endDay: days[days.length - 1]!,
  });

  const byDay = new Map(overview.dailyVisitors.map((row) => [row.day, row.visitors]));
  const chats = new Map(overview.dailyCounts.map((row) => [row.day, row]));
  const table: AnalyticsDayRow[] = days.map((day) => ({
    day,
    visitors: byDay.get(day) ?? 0,
    chats: chats.get(day)?.chats ?? 0,
    escalations: chats.get(day)?.escalations ?? 0,
  }));

  return {
    period,
    timeZone,
    retentionDays,
    earliestDay: addCalendarDays(days[days.length - 1]!, -(retentionDays - 1)),
    days: table,
    totals: {
      liveVisitors: overview.liveVisitors,
      visitors: overview.totalVisitors,
      chats: table.reduce((sum, row) => sum + row.chats, 0),
      escalations: table.reduce((sum, row) => sum + row.escalations, 0),
    },
  };
}

/**
 * Drops analytics rows older than the analytics retention period. This is
 * the analytics expiry's whole story: it runs regardless of transcript
 * retention, because the two windows are defined separately (ticket 17) and
 * a college that keeps transcripts forever still needs visitor identifiers
 * to expire.
 */
export async function runAnalyticsExpiry(
  db: AppDatabase,
  store: Store,
  now: Date = new Date(),
): Promise<{ removedPresence: number; removedDaily: number }> {
  const retentionDays = await getAnalyticsRetentionDays(db);
  const today = reportingDay(await getReportingTimeZone(db), now);
  const cutoff = addCalendarDays(today, -(retentionDays - 1));
  return store.expireAnalyticsBefore(cutoff);
}

/**
 * The request-facing wrapper: analytics expiry rides ordinary staff traffic,
 * so a failing sweep must never take the desk down with it.
 */
export async function expireAnalytics(
  db: AppDatabase,
  store: Store,
  now: Date = new Date(),
): Promise<{ removedPresence: number; removedDaily: number }> {
  try {
    return await runAnalyticsExpiry(db, store, now);
  } catch (error) {
    console.error("analytics expiry failed:", error);
    return { removedPresence: 0, removedDaily: 0 };
  }
}
