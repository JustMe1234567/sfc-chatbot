import type { DatabaseSync } from "node:sqlite";

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

export function getAlertRecipients(db: DatabaseSync): string[] {
  const raw = getSetting(db, ALERT_RECIPIENTS_KEY);
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
