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

export const MESSAGE_RATE_LIMIT = 20;
export const CREATE_RATE_LIMIT = 100;
export const HISTORY_RATE_LIMIT = 60;
/** Public credential-free reads (topic buttons), tuned like history reads. */
export const TOPICS_RATE_LIMIT = 60;
export const RATE_WINDOW_MS = 60_000;

function windowMs(): number {
  // RATE_WINDOW_MS lets tests widen the window so burst tests are
  // deterministic regardless of machine load. Production keeps the default.
  const override = Number(process.env.RATE_WINDOW_MS);
  return Number.isFinite(override) && override > 0 ? override : RATE_WINDOW_MS;
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
