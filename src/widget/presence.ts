import { DEFAULT_ANALYTICS_RETENTION_DAYS } from "@/settings";

/**
 * The visitor widget's anonymous presence signal (ticket 17). A random UUID
 * lives in the widget's localStorage on the chatbot origin — shared by every
 * tab of the same browser, never derived from anything a person typed or
 * identified themselves with — and rotates at least as often as the
 * analytics retention period. A beat is sent only while the embedded page is
 * actually visible: a backgrounded tab or closed page must not keep its
 * browser falsely live.
 */

export const BROWSER_ID_STORAGE_KEY = "sfcw-analytics-id";

/** The shape the server accepts for a presence browser id. */
export const BROWSER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Modest by design: beats every 45 seconds while the page is visible. */
export const PRESENCE_HEARTBEAT_INTERVAL_MS = 45_000;

/** Expiry arithmetic for the id and its stored twin (ticket 34). */
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PresenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StoredId {
  id: string;
  createdAt: string;
  expiresAt: string;
}

function isStoredId(value: unknown): value is StoredId {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<StoredId>;
  return (
    typeof candidate.id === "string" &&
    BROWSER_ID_PATTERN.test(candidate.id) &&
    typeof candidate.createdAt === "string" &&
    !Number.isNaN(Date.parse(candidate.createdAt)) &&
    typeof candidate.expiresAt === "string" &&
    !Number.isNaN(Date.parse(candidate.expiresAt))
  );
}

function readStoredId(storage: PresenceStorage): StoredId | null {
  const raw = storage.getItem(BROWSER_ID_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStoredId(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The browser's anonymous identifier: reads it from storage, or creates and
 * stores a fresh UUID whose lifetime is bounded to the retention period
 * known at creation. An expired, corrupt, or malformed record rotates to a
 * new identifier — the same browser becomes unrecognizable, by design.
 */
export function browserId(storage: PresenceStorage, now: Date, retentionDays: number): string {
  const stored = readStoredId(storage);
  if (stored && new Date(stored.expiresAt).getTime() > now.getTime()) {
    return stored.id;
  }
  const createdAt = now.toISOString();
  const replacement: StoredId = {
    id: crypto.randomUUID(),
    createdAt,
    expiresAt: new Date(now.getTime() + retentionDays * DAY_MS).toISOString(),
  };
  storage.setItem(BROWSER_ID_STORAGE_KEY, JSON.stringify(replacement));
  return replacement.id;
}

/**
 * Applies the retention period the server reports. It can only shorten the
 * lifetime from here: a longer period never extends past the bound the
 * identifier was created with, so an active browser's identifier cannot
 * quietly become a long-lived cross-visit tracker.
 */
export function noteRetention(
  storage: PresenceStorage,
  id: string,
  now: Date,
  retentionDays: number,
): void {
  const stored = readStoredId(storage);
  if (!stored || stored.id !== id || retentionDays <= 0) {
    return;
  }
  const shortened = now.getTime() + retentionDays * DAY_MS;
  if (shortened < new Date(stored.expiresAt).getTime()) {
    storage.setItem(
      BROWSER_ID_STORAGE_KEY,
      JSON.stringify({ ...stored, expiresAt: new Date(shortened).toISOString() }),
    );
  }
}

export interface PresenceBeat {
  storage: PresenceStorage;
  visibility(): string;
  send(browserId: string): Promise<{ retentionDays?: number } | null>;
  now?(): Date;
  /** Overridable for tests; production uses the 45-second default. */
  intervalMs?: number;
  /** Overridable for tests; production listens on document visibilitychange. */
  addVisibilityListener?(handler: () => void): void;
  removeVisibilityListener?(handler: () => void): void;
}

/**
 * One heartbeat: a no-op unless the embedded page is visible, otherwise a
 * presence post for this browser, applying the retention the server reports.
 * Returns the send result, or null when nothing was sent.
 */
export async function presenceBeat(beat: PresenceBeat): Promise<{ retentionDays?: number } | null> {
  if (beat.visibility() !== "visible") {
    return null;
  }
  const now = beat.now?.() ?? new Date();
  const id = browserId(beat.storage, now, DEFAULT_ANALYTICS_RETENTION_DAYS);
  let result: { retentionDays?: number } | null;
  try {
    result = await beat.send(id);
  } catch {
    return null; // Transient trouble; the next tick retries.
  }
  if (result?.retentionDays !== undefined) {
    noteRetention(beat.storage, id, now, result.retentionDays);
  }
  return result;
}

/**
 * The widget's heartbeat loop: one beat right away, one per interval, and
 * one whenever the page becomes visible again — each gated on visibility, so
 * a hidden tab, a closed page, or a browser that throttles background timers
 * all stop the signal. Returns the stop function.
 */
export function startPresenceHeartbeat(beat: PresenceBeat): () => void {
  let stopped = false;
  const onVisible = (): void => {
    if (beat.visibility() === "visible") {
      void presenceBeat(beat);
    }
  };
  const addListener =
    beat.addVisibilityListener ??
    ((handler: () => void) => {
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", handler);
      }
    });
  const removeListener =
    beat.removeVisibilityListener ??
    ((handler: () => void) => {
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handler);
      }
    });
  addListener(onVisible);
  void presenceBeat(beat);
  const timer = setInterval(() => {
    if (!stopped) {
      void presenceBeat(beat);
    }
  }, beat.intervalMs ?? PRESENCE_HEARTBEAT_INTERVAL_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
    removeListener(onVisible);
  };
}
