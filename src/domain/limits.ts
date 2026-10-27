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

/** How long after the last visitor request the visitor counts as departed. */
export const VISITOR_PRESENCE_WINDOW_MS = 60_000;

export function visitorPresenceWindowMs(): number {
  // VISITOR_PRESENCE_WINDOW_MS lets tests shrink the window so departure is
  // deterministic regardless of machine speed. Production keeps the default.
  return envMs("VISITOR_PRESENCE_WINDOW_MS", VISITOR_PRESENCE_WINDOW_MS);
}

/** Whether the visitor is gone: presence older than the window, or never seen. */
export function visitorDeparted(conversation: {
  visitorLastSeenAt: string | null;
}): boolean {
  if (!conversation.visitorLastSeenAt) {
    return true;
  }
  return Date.now() - new Date(conversation.visitorLastSeenAt).getTime() > visitorPresenceWindowMs();
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
