import type { DatabaseSync } from "node:sqlite";
import { normalizeText } from "./domain/matcher";

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
