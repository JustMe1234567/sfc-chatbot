import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The widget's anonymous browser identifier and presence heartbeat
 * (ticket 17). The id is a random UUID in the chat widget's localStorage on
 * the chatbot origin — shared across tabs of the same browser, rotated at
 * least as often as the analytics retention period, and never derived from
 * anything a person typed or identified themselves with. Heartbeats fire
 * only while the embedded page is actually visible.
 */

interface StoredId {
  id: string;
  createdAt: string;
  expiresAt: string;
}

function shimStorage(): { store: Map<string, string>; getItem(k: string): string | null; setItem(k: string, v: string): void } {
  const store = new Map<string, string>();
  return { store, getItem: (key) => store.get(key) ?? null, setItem: (key, value) => void store.set(key, value) };
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe("anonymous browser identifier", () => {
  it("creates a fresh UUID with a creation-bounded expiry when none exists", async () => {
    const { browserId, BROWSER_ID_STORAGE_KEY } = await import("../src/widget/presence");
    const storage = shimStorage();
    const now = new Date("2026-10-28T09:00:00Z");
    const id = browserId(storage, now, 90);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const stored = JSON.parse(storage.store.get(BROWSER_ID_STORAGE_KEY)!) as StoredId;
    expect(stored.id).toBe(id);
    expect(new Date(stored.expiresAt).getTime() - new Date(stored.createdAt).getTime()).toBe(
      90 * DAY_MS,
    );
  });

  it("reuses the stored identifier across reads, as tabs share it", async () => {
    const { browserId } = await import("../src/widget/presence");
    const storage = shimStorage();
    const now = new Date("2026-10-28T09:00:00Z");
    const first = browserId(storage, now, 90);
    const second = browserId(storage, new Date(now.getTime() + 60 * 1000), 90);
    expect(second).toBe(first);
  });

  it("rotates the identifier once it has lived out its retention bound", async () => {
    const { browserId } = await import("../src/widget/presence");
    const storage = shimStorage();
    const start = new Date("2026-10-01T09:00:00Z");
    const first = browserId(storage, start, 7);
    const later = new Date(start.getTime() + 7 * DAY_MS + 1000);
    const second = browserId(storage, later, 7);
    expect(second).not.toBe(first);
    const stored = JSON.parse(storage.store.get("sfcw-analytics-id")!) as StoredId;
    expect(stored.id).toBe(second);
    expect(stored.createdAt).toBe(later.toISOString());
  });

  it("treats corrupt or malformed stored identifiers as absent", async () => {
    const { browserId, BROWSER_ID_STORAGE_KEY } = await import("../src/widget/presence");
    const now = new Date("2026-10-28T09:00:00Z");

    const corrupt = shimStorage();
    corrupt.setItem(BROWSER_ID_STORAGE_KEY, "{not json");
    expect(browserId(corrupt, now, 90)).toMatch(/^[0-9a-f-]{36}$/);

    const wrongShape = shimStorage();
    wrongShape.setItem(BROWSER_ID_STORAGE_KEY, JSON.stringify({ id: "hello" }));
    expect(browserId(wrongShape, now, 90)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("only ever shortens the lifetime when the server reports a smaller retention period", async () => {
    const { browserId, noteRetention, BROWSER_ID_STORAGE_KEY } = await import(
      "../src/widget/presence"
    );
    const storage = shimStorage();
    const now = new Date("2026-10-28T09:00:00Z");
    const id = browserId(storage, now, 90);
    const original = (JSON.parse(storage.store.get(BROWSER_ID_STORAGE_KEY)!) as StoredId).expiresAt;

    // A longer period never extends past the creation-time bound: the same
    // random id must not quietly become a long-lived cross-visit tracker.
    noteRetention(storage, id, now, 365);
    let stored = JSON.parse(storage.store.get(BROWSER_ID_STORAGE_KEY)!) as StoredId;
    expect(stored.expiresAt).toBe(original);

    // A shorter period expires the id sooner than its original bound.
    noteRetention(storage, id, now, 7);
    stored = JSON.parse(storage.store.get(BROWSER_ID_STORAGE_KEY)!) as StoredId;
    expect(new Date(stored.expiresAt).getTime()).toBe(now.getTime() + 7 * DAY_MS);
    expect(stored.id).toBe(id);
  });
});

describe("presence heartbeat", () => {
  const storage = shimStorage();
  const baseBeat = {
    storage,
    now: () => new Date("2026-10-28T09:00:00Z"),
  };

  beforeEach(() => {
    storage.store.clear();
  });

  it("sends nothing while the embedded page is hidden", async () => {
    const { presenceBeat } = await import("../src/widget/presence");
    const send = vi.fn(async () => ({ retentionDays: 90 }));
    const result = await presenceBeat({ ...baseBeat, visibility: () => "hidden", send });
    expect(result).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("sends the stored identifier while the page is visible and applies the reported retention", async () => {
    const { presenceBeat, browserId, BROWSER_ID_STORAGE_KEY } = await import(
      "../src/widget/presence"
    );
    const id = browserId(storage, baseBeat.now(), 90);
    const send = vi.fn(async (sent: string) => ({ retentionDays: 7 }));
    const result = await presenceBeat({ ...baseBeat, visibility: () => "visible", send });
    expect(result).toEqual({ retentionDays: 7 });
    expect(send).toHaveBeenCalledWith(id);
    const stored = JSON.parse(storage.store.get(BROWSER_ID_STORAGE_KEY)!) as StoredId;
    expect(new Date(stored.expiresAt).getTime()).toBe(
      baseBeat.now().getTime() + 7 * DAY_MS,
    );
  });

  it("survives a failed heartbeat and sends nothing else on its behalf", async () => {
    const { presenceBeat } = await import("../src/widget/presence");
    const send = vi.fn(async () => {
      throw new Error("network down");
    });
    const result = await presenceBeat({ ...baseBeat, visibility: () => "visible", send });
    expect(result).toBeNull();
  });

  it("beats immediately, on the interval, and on becoming visible, until stopped", async () => {
    vi.useFakeTimers();
    try {
      const { startPresenceHeartbeat } = await import("../src/widget/presence");
      let visible = true;
      const send = vi.fn(async () => null);
      const listeners: (() => void)[] = [];
      const stop = startPresenceHeartbeat({
        ...baseBeat,
        visibility: () => (visible ? "visible" : "hidden"),
        send,
        intervalMs: 45_000,
        addVisibilityListener: (handler) => void listeners.push(handler),
        removeVisibilityListener: (handler) => {
          const index = listeners.indexOf(handler);
          if (index !== -1) listeners.splice(index, 1);
        },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(send).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(45_000);
      expect(send).toHaveBeenCalledTimes(2);

      // A hidden page stops beating even as timers elapse…
      visible = false;
      await vi.advanceTimersByTimeAsync(90_000);
      expect(send).toHaveBeenCalledTimes(2);

      // …and becoming visible again beats at once.
      visible = true;
      for (const listener of listeners) listener();
      await vi.advanceTimersByTimeAsync(0);
      expect(send).toHaveBeenCalledTimes(3);

      stop();
      await vi.advanceTimersByTimeAsync(180_000);
      expect(send).toHaveBeenCalledTimes(3);
      expect(listeners).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
