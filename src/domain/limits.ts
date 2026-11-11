import type { AppDatabase } from "../db/appDatabase";

/**
 * The rate-limit decision (ticket 24): counters for the abuse-facing public
 * endpoints — conversation creation, return-link redemption, and visitor
 * messages — must hold across serverless instances, so on a database backend
 * they live as shared rows in `rate_limit_hits` via `createSharedRateLimiter`
 * (src/api/rateLimit.ts). This module stays server-import-free (the widget
 * imports its constants), which is why the shared-counter mechanism lives in
 * src/api and only this decision is recorded here.
 *
 * `createRateLimiter`'s per-process in-memory counters remain the right tool
 * where the limit is inherently per-process anyway: the credential-free
 * reads (topics, welcome, handoff options, presence beats) and the
 * per-conversation guards (history, clear, contact). SQLite mode has no
 * shared store to count in, so every limiter — including the shared ones —
 * runs in-memory there, with the same per-scope/key window contract. The
 * shared counters' maintenance sweep below follows this module's usual
 * (db) parameter pattern, like the retention and analytics sweeps.
 */

export const MAX_MESSAGE_LENGTH = 1000;

export type TextValidation =
  | { ok: true; text: string }
  | { ok: false; code: "empty" | "invalid" | "too_long"; message: string };

export function validateVisitorText(input: unknown): TextValidation {
  if (typeof input !== "string") {
    return { ok: false, code: "invalid", message: "A question is required." };
  }
  const text = input.trim();
  if (text.length === 0) {
    return { ok: false, code: "empty", message: "A question is required." };
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      code: "too_long",
      message: `Questions are limited to ${MAX_MESSAGE_LENGTH} characters.`,
    };
  }
  return { ok: true, text };
}

/** An env-overridable millisecond duration, for deterministic tests. */
export function envMs(name: string, fallbackMs: number): number {
  const override = Number(process.env[name]);
  return Number.isFinite(override) && override > 0 ? override : fallbackMs;
}

export const MESSAGE_RATE_LIMIT = 20;
export const CREATE_RATE_LIMIT = 100;
export const HISTORY_RATE_LIMIT = 60;
/** Public credential-free reads (topic buttons), tuned like history reads. */
export const TOPICS_RATE_LIMIT = 60;
/** Unauthenticated return-link redemptions per client per window. */
export const RETURN_RATE_LIMIT = 20;
/**
 * Anonymous presence beats (ticket 17): one browser beats about every 45
 * seconds, so a generous ceiling absorbs a shared campus address full of
 * open tabs while still stopping floods.
 */
export const PRESENCE_RATE_LIMIT = 240;
export const RATE_WINDOW_MS = 60_000;

export const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EmailValidation =
  | { ok: true; email: string }
  | { ok: false; code: "invalid_email"; message: string };

export function validateVisitorEmail(input: unknown): EmailValidation {
  if (typeof input !== "string") {
    return { ok: false, code: "invalid_email", message: "Provide an email address." };
  }
  const email = input.trim();
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    return { ok: false, code: "invalid_email", message: "Provide a valid email address." };
  }
  return { ok: true, email };
}

/** The visitor contact details required before every new chat (ticket 66). */
export const MAX_NAME_LENGTH = 80;
export const MAX_PHONE_LENGTH = 24;
/** Formatting characters only; the digit floor and ceiling do the real work. */
const PHONE_PATTERN = /^[+()\-.\s\d]+$/;

export type NameValidation =
  | { ok: true; name: string }
  | { ok: false; code: "invalid_name"; message: string };

export function validateVisitorName(input: unknown): NameValidation {
  if (typeof input !== "string") {
    return { ok: false, code: "invalid_name", message: "Enter your full name." };
  }
  const name = input.trim();
  if (name.length === 0) {
    return { ok: false, code: "invalid_name", message: "Enter your full name." };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      code: "invalid_name",
      message: `Names are limited to ${MAX_NAME_LENGTH} characters.`,
    };
  }
  return { ok: true, name };
}

export type PhoneValidation =
  | { ok: true; phone: string }
  | { ok: false; code: "invalid_phone"; message: string };

export function validateVisitorPhone(input: unknown): PhoneValidation {
  if (typeof input !== "string") {
    return { ok: false, code: "invalid_phone", message: "Enter a phone number." };
  }
  const phone = input.trim();
  const digits = phone.replace(/\D/g, "");
  // ITU numbering plans cap at 15 digits; the floor keeps "1234" out while
  // the character ceiling rejects excessively long values.
  if (
    phone.length === 0 ||
    phone.length > MAX_PHONE_LENGTH ||
    digits.length < 7 ||
    digits.length > 15 ||
    !PHONE_PATTERN.test(phone)
  ) {
    return { ok: false, code: "invalid_phone", message: "Enter a valid phone number." };
  }
  return { ok: true, phone };
}

export interface VisitorContact {
  name: string;
  email: string;
  phone: string;
}

export type ContactValidation =
  | { ok: true; contact: VisitorContact }
  | { ok: false; code: "invalid_name" | "invalid_email" | "invalid_phone"; message: string };

/** Validates the chat-start form's three required fields in order (ticket 66). */
export function validateVisitorContact(body: unknown): ContactValidation {
  const fields = (body ?? {}) as { fullName?: unknown; email?: unknown; phone?: unknown };
  const name = validateVisitorName(fields.fullName);
  if (!name.ok) {
    return name;
  }
  const email = validateVisitorEmail(fields.email);
  if (!email.ok) {
    return email;
  }
  const phone = validateVisitorPhone(fields.phone);
  if (!phone.ok) {
    return phone;
  }
  return { ok: true, contact: { name: name.name, email: email.email, phone: phone.phone } };
}

function windowMs(): number {
  // RATE_WINDOW_MS lets tests widen the window so burst tests are
  // deterministic regardless of machine load. Production keeps the default.
  return envMs("RATE_WINDOW_MS", RATE_WINDOW_MS);
}

export function createRateLimiter(limit: number) {
  const windowMsOverride = windowMs();
  const windowStart = new Map<string, number>();
  const counts = new Map<string, number>();

  return {
    check(key: string, now = Date.now()): boolean {
      const start = windowStart.get(key);
      if (start === undefined || now - start >= windowMsOverride) {
        windowStart.set(key, now);
        counts.set(key, 1);
        return true;
      }
      const count = counts.get(key) ?? 0;
      if (count >= limit) {
        return false;
      }
      counts.set(key, count + 1);
      return true;
    },
  };
}

/**
 * Maintenance for the shared rate-limit counters (ticket 24): drops every
 * window older than the previous one — a budget can never recur two windows
 * later, so those rows are pure debris. Returns the number of rows removed.
 */
export async function pruneRateLimitWindows(
  db: AppDatabase,
  now = Date.now(),
): Promise<number> {
  const cutoff = new Date(now - 2 * windowMs()).toISOString();
  const { changes } = await db.run("DELETE FROM rate_limit_hits WHERE window_start < ?", cutoff);
  return changes;
}
