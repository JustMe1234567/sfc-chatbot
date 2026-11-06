import type { AppDatabase } from "./db/appDatabase";
import { normalizeText } from "./domain/matcher";
import type { SupportHours } from "./domain/types";
import { DEFAULT_WELCOME_MESSAGE, isValidWelcomeMessage } from "./domain/welcome";

export interface SettingRow {
  key: string;
  value: string;
  updatedAt: string;
}

export async function getSetting(db: AppDatabase, key: string): Promise<string | null> {
  const row = await db.get<{ value: string }>("SELECT value FROM settings WHERE key = ?", key);
  return row ? row.value : null;
}

export async function setSetting(db: AppDatabase, key: string, value: string): Promise<void> {
  await db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    value,
    new Date().toISOString(),
  );
}

const ALERT_RECIPIENTS_KEY = "alert_recipients";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A string-list setting; a corrupt value reads as empty rather than throwing. */
async function getStringListSetting(db: AppDatabase, key: string): Promise<string[]> {
  const raw = await getSetting(db, key);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function getAlertRecipients(db: AppDatabase): Promise<string[]> {
  return getStringListSetting(db, ALERT_RECIPIENTS_KEY);
}

export async function setAlertRecipients(db: AppDatabase, recipients: string[]): Promise<void> {
  await setSetting(db, ALERT_RECIPIENTS_KEY, JSON.stringify(recipients));
}

export function isValidRecipientList(recipients: unknown): recipients is string[] {
  return (
    Array.isArray(recipients) &&
    recipients.length > 0 &&
    recipients.length <= 10 &&
    recipients.every((item) => typeof item === "string" && EMAIL_PATTERN.test(item))
  );
}

/**
 * The single-address half of the list rule (ticket 54): the stacked
 * recipient boxes validate each entry inline as it is added or edited,
 * with the whole-list PUT and `isValidRecipientList` still the final
 * authority.
 */
export function isValidRecipientEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

const ESCALATION_PHRASES_KEY = "escalation_phrases";

/** Launch defaults until editors configure the college's own wording. */
export const DEFAULT_ESCALATION_PHRASES: readonly string[] = [
  "talk to a person",
  "speak to a human",
];

export function getEscalationPhrases(db: AppDatabase): Promise<string[]> {
  return getStringListSetting(db, ESCALATION_PHRASES_KEY);
}

export async function setEscalationPhrases(db: AppDatabase, phrases: string[]): Promise<void> {
  await setSetting(db, ESCALATION_PHRASES_KEY, JSON.stringify(phrases));
}

/** Zero phrases is valid (feature off); any phrase must stay a real phrase. */
export function isValidEscalationPhraseList(phrases: unknown): phrases is string[] {
  return (
    Array.isArray(phrases) &&
    phrases.length <= 50 &&
    phrases.every(
      (item) =>
        typeof item === "string" &&
        item.trim().length > 0 &&
        item.trim().length <= 200 &&
        normalizeText(item) !== "",
    )
  );
}

/** Insert-if-absent, mirroring the answer-rule seed: editors own the value
 *  from the first boot, so restarts never overwrite their wording. */
export async function seedEscalationPhrases(db: AppDatabase): Promise<void> {
  if ((await getSetting(db, ESCALATION_PHRASES_KEY)) === null) {
    await setEscalationPhrases(db, [...DEFAULT_ESCALATION_PHRASES]);
  }
}

const TRANSCRIPT_RETENTION_KEY = "transcript_retention_days";

export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 3650;

/**
 * The retention period in effect while the college has not set one (ticket
 * 47): History transcripts expire 30 days after they enter History (closure,
 * or the end of the inactivity window — ticket 62). An explicit owner
 * setting always wins; the wire format keeps reporting null for "no explicit
 * period" so the dashboard can say which value is the default.
 */
export const DEFAULT_RETENTION_DAYS = 30;

/**
 * The stored transcript-retention setting, read as one of three states: no
 * owner period exists (the 30-day default applies), the stored value is not
 * a valid period (the sweep must refuse to run — retention must never delete
 * on the strength of a bad value), or an explicit period in days that wins
 * over the default.
 */
export type TranscriptRetentionSetting =
  | { kind: "absent" }
  | { kind: "invalid"; raw: string }
  | { kind: "set"; days: number };

export async function readTranscriptRetention(db: AppDatabase): Promise<TranscriptRetentionSetting> {
  const raw = await getSetting(db, TRANSCRIPT_RETENTION_KEY);
  if (raw === null) {
    return { kind: "absent" };
  }
  const parsed = Number(raw);
  return isValidRetentionDays(parsed) ? { kind: "set", days: parsed } : { kind: "invalid", raw };
}

/**
 * The configured transcript retention period in days, or null while the
 * college has not set one (the 30-day default then applies, ticket 47). A
 * corrupt or hand-edited row also reads as null here, mirroring support
 * hours — but the sweep additionally refuses to run on it, so a bad value
 * can still never cause a deletion.
 */
export async function getTranscriptRetentionDays(db: AppDatabase): Promise<number | null> {
  const setting = await readTranscriptRetention(db);
  return setting.kind === "set" ? setting.days : null;
}

/** Sets the period; null resets it to the 30-day default. */
export async function setTranscriptRetentionDays(db: AppDatabase, days: number | null): Promise<void> {
  if (days === null) {
    await db.run("DELETE FROM settings WHERE key = ?", TRANSCRIPT_RETENTION_KEY);
    return;
  }
  await setSetting(db, TRANSCRIPT_RETENTION_KEY, String(days));
}

/** Whole days within a sane lifetime: at least a day, at most a decade. */
export function isValidRetentionDays(input: unknown): input is number {
  return (
    typeof input === "number" &&
    Number.isInteger(input) &&
    input >= MIN_RETENTION_DAYS &&
    input <= MAX_RETENTION_DAYS
  );
}

const SUPPORT_HOURS_KEY = "support_hours";

export async function getSupportHours(db: AppDatabase): Promise<SupportHours | null> {
  const raw = await getSetting(db, SUPPORT_HOURS_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    // The same predicate as writes: a corrupt or hand-edited row reads as
    // unconfigured (general message) instead of reaching the visitor path
    // with values that could throw or show a bogus schedule.
    return isValidSupportHours(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function setSupportHours(db: AppDatabase, hours: SupportHours | null): Promise<void> {
  // A null clear removes the key so reads and the dashboard treat the desk
  // as unconfigured rather than remembering a stale schedule.
  if (hours === null) {
    await db.run("DELETE FROM settings WHERE key = ?", SUPPORT_HOURS_KEY);
    return;
  }
  await setSetting(db, SUPPORT_HOURS_KEY, JSON.stringify(hours));
}

/** The zone must be a real IANA time zone; shared by hours and analytics. */
function isIANATimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Shape + range validation; the zone must be a real IANA time zone. */
export function isValidSupportHours(input: unknown): input is SupportHours {
  if (typeof input !== "object" || input === null) {
    return false;
  }
  const candidate = input as Partial<SupportHours>;
  if (typeof candidate.timeZone !== "string" || !Array.isArray(candidate.days)) {
    return false;
  }
  if (!isIANATimeZone(candidate.timeZone)) {
    return false;
  }
  const { startMinute, endMinute } = candidate;
  if (
    typeof startMinute !== "number" ||
    typeof endMinute !== "number" ||
    !Number.isInteger(startMinute) ||
    !Number.isInteger(endMinute) ||
    startMinute < 0 ||
    startMinute > 23 * 60 + 59 ||
    endMinute < 1 ||
    endMinute > 24 * 60 ||
    endMinute <= startMinute
  ) {
    return false;
  }
  const days = candidate.days;
  if (days.length === 0 || days.length > 7) {
    return false;
  }
  return days.every(
    (day) => Number.isInteger(day) && day >= 0 && day <= 6 && days.indexOf(day) === days.lastIndexOf(day),
  );
}

const REPORTING_TIME_ZONE_KEY = "reporting_time_zone";

/** Day boundaries are always drawn somewhere; the ticket fixes the default. */
export const DEFAULT_REPORTING_TIME_ZONE = "Asia/Singapore";

/**
 * Analytics outlives transcripts by design (kept separately, ticket 17), so
 * the default is generous enough for month-over-month reading while still
 * bounded. The owner's setting always wins.
 */
export const DEFAULT_ANALYTICS_RETENTION_DAYS = 90;

/**
 * The reporting time zone for analytics day boundaries (ticket 17). Unlike
 * support hours there is no unconfigured state: day boundaries are always
 * drawn somewhere, so an unset or corrupt value reads as the ticket's
 * default rather than disabling reporting.
 */
export async function getReportingTimeZone(db: AppDatabase): Promise<string> {
  const raw = await getSetting(db, REPORTING_TIME_ZONE_KEY);
  if (raw !== null && isValidTimeZoneName(raw)) {
    return raw;
  }
  return DEFAULT_REPORTING_TIME_ZONE;
}

export async function setReportingTimeZone(db: AppDatabase, timeZone: string): Promise<void> {
  await setSetting(db, REPORTING_TIME_ZONE_KEY, timeZone);
}

/** The zone must be a real IANA time zone (same bar as support hours). */
export function isValidTimeZoneName(input: unknown): input is string {
  if (typeof input !== "string" || input.length === 0 || input.length > 64) {
    return false;
  }
  return isIANATimeZone(input);
}

const ANALYTICS_RETENTION_KEY = "analytics_retention_days";

/**
 * How many days of analytics rows (anonymous presence and daily rollups)
 * are kept before expiry removes them (ticket 17). Defined separately from
 * transcript retention: purging a transcript must never change reported
 * totals, and shedding analytics rows must not delete visitor transcripts.
 * Expiry is always on — an unset or corrupt value reads as the default,
 * never as "keep indefinitely"; transcript retention works the same way
 * since its 30-day default (ticket 47).
 */
export async function getAnalyticsRetentionDays(db: AppDatabase): Promise<number> {
  const raw = await getSetting(db, ANALYTICS_RETENTION_KEY);
  if (raw !== null) {
    const parsed = Number(raw);
    if (isValidRetentionDays(parsed)) {
      return parsed;
    }
  }
  return DEFAULT_ANALYTICS_RETENTION_DAYS;
}

export async function setAnalyticsRetentionDays(db: AppDatabase, days: number): Promise<void> {
  await setSetting(db, ANALYTICS_RETENTION_KEY, String(days));
}

const WELCOME_MESSAGE_KEY = "welcome_message";

/**
 * The fresh-chat greeting (ticket 41): a presentation-only line the widget
 * renders from the published setting, with the domain default standing in
 * while unconfigured or when a hand-edited row fails validation. Never
 * stored as a message; opening the widget creates no conversation.
 */
export async function getWelcomeMessage(db: AppDatabase): Promise<string> {
  const raw = await getSetting(db, WELCOME_MESSAGE_KEY);
  return isValidWelcomeMessage(raw) ? raw : DEFAULT_WELCOME_MESSAGE;
}

export async function setWelcomeMessage(db: AppDatabase, text: string): Promise<void> {
  await setSetting(db, WELCOME_MESSAGE_KEY, text.trim());
}
