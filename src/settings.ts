import type { DatabaseSync } from "node:sqlite";
import { normalizeText } from "./domain/matcher";
import type { SupportHours } from "./domain/types";

export interface SettingRow {
  key: string;
  value: string;
  updatedAt: string;
}

export function getSetting(db: DatabaseSync, key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row ? row.value : null;
}

export function setSetting(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, new Date().toISOString());
}

const ALERT_RECIPIENTS_KEY = "alert_recipients";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A string-list setting; a corrupt value reads as empty rather than throwing. */
function getStringListSetting(db: DatabaseSync, key: string): string[] {
  const raw = getSetting(db, key);
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

export function getAlertRecipients(db: DatabaseSync): string[] {
  return getStringListSetting(db, ALERT_RECIPIENTS_KEY);
}

export function setAlertRecipients(db: DatabaseSync, recipients: string[]): void {
  setSetting(db, ALERT_RECIPIENTS_KEY, JSON.stringify(recipients));
}

export function isValidRecipientList(recipients: unknown): recipients is string[] {
  return (
    Array.isArray(recipients) &&
    recipients.length > 0 &&
    recipients.length <= 10 &&
    recipients.every((item) => typeof item === "string" && EMAIL_PATTERN.test(item))
  );
}

const ESCALATION_PHRASES_KEY = "escalation_phrases";

/** Launch defaults until editors configure the college's own wording. */
export const DEFAULT_ESCALATION_PHRASES: readonly string[] = [
  "talk to a person",
  "speak to a human",
];

export function getEscalationPhrases(db: DatabaseSync): string[] {
  return getStringListSetting(db, ESCALATION_PHRASES_KEY);
}

export function setEscalationPhrases(db: DatabaseSync, phrases: string[]): void {
  setSetting(db, ESCALATION_PHRASES_KEY, JSON.stringify(phrases));
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
export function seedEscalationPhrases(db: DatabaseSync): void {
  if (getSetting(db, ESCALATION_PHRASES_KEY) === null) {
    setEscalationPhrases(db, [...DEFAULT_ESCALATION_PHRASES]);
  }
}

const TRANSCRIPT_RETENTION_KEY = "transcript_retention_days";

export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 3650;

/**
 * The configured transcript retention period in days, or null while the
 * college has not set one (closed transcripts are then kept indefinitely).
 * A corrupt or hand-edited row reads as unconfigured, mirroring support
 * hours: retention must never delete on the strength of a bad value.
 */
export function getTranscriptRetentionDays(db: DatabaseSync): number | null {
  const raw = getSetting(db, TRANSCRIPT_RETENTION_KEY);
  if (raw === null) {
    return null;
  }
  const parsed = Number(raw);
  return isValidRetentionDays(parsed) ? parsed : null;
}

/** Sets the period; null clears it back to keeping closed transcripts. */
export function setTranscriptRetentionDays(db: DatabaseSync, days: number | null): void {
  if (days === null) {
    db.prepare("DELETE FROM settings WHERE key = ?").run(TRANSCRIPT_RETENTION_KEY);
    return;
  }
  setSetting(db, TRANSCRIPT_RETENTION_KEY, String(days));
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

export function getSupportHours(db: DatabaseSync): SupportHours | null {
  const raw = getSetting(db, SUPPORT_HOURS_KEY);
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

export function setSupportHours(db: DatabaseSync, hours: SupportHours | null): void {
  // A null clear removes the key so reads and the dashboard treat the desk
  // as unconfigured rather than remembering a stale schedule.
  if (hours === null) {
    db.prepare("DELETE FROM settings WHERE key = ?").run(SUPPORT_HOURS_KEY);
    return;
  }
  setSetting(db, SUPPORT_HOURS_KEY, JSON.stringify(hours));
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
export function getReportingTimeZone(db: DatabaseSync): string {
  const raw = getSetting(db, REPORTING_TIME_ZONE_KEY);
  if (raw !== null && isValidTimeZoneName(raw)) {
    return raw;
  }
  return DEFAULT_REPORTING_TIME_ZONE;
}

export function setReportingTimeZone(db: DatabaseSync, timeZone: string): void {
  setSetting(db, REPORTING_TIME_ZONE_KEY, timeZone);
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
 * totals, and keeping transcripts forever must not keep visitor identifiers.
 * Like reporting above, expiry is always on — an unset or corrupt value
 * reads as the default, never as "keep indefinitely".
 */
export function getAnalyticsRetentionDays(db: DatabaseSync): number {
  const raw = getSetting(db, ANALYTICS_RETENTION_KEY);
  if (raw !== null) {
    const parsed = Number(raw);
    if (isValidRetentionDays(parsed)) {
      return parsed;
    }
  }
  return DEFAULT_ANALYTICS_RETENTION_DAYS;
}

export function setAnalyticsRetentionDays(db: DatabaseSync, days: number): void {
  setSetting(db, ANALYTICS_RETENTION_KEY, String(days));
}
