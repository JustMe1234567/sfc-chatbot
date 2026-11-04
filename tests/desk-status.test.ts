import { describe, expect, it } from "vitest";
import {
  deskAttentionEvents,
  deskStatus,
  DESK_STATUS_LABELS,
  type DeskItem,
} from "../src/domain/inbox";
import {
  CUE_FRESH_MS,
  createAttentionCues,
  SEEN_ATTENTION_KEY,
  SOUND_MUTED_KEY,
  type StorageLike,
} from "../src/domain/attentionCues";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/paths";

function item(overrides: Partial<DeskItem>): DeskItem {
  return {
    id: "conv-1",
    state: "bot_active",
    active: true,
    attention: false,
    attentionAt: null,
    createdAt: "2026-11-05T09:00:00.000Z",
    lastActivityAt: "2026-11-05T09:05:00.000Z",
    messageCount: 2,
    lastMessage: { role: "visitor", text: "Hello", createdAt: "2026-11-05T09:05:00.000Z" },
    ...overrides,
  };
}

describe("desk status tiers (ticket 44)", () => {
  it("maps waiting escalations to Needs human, the strongest tier", () => {
    expect(deskStatus({ state: "awaiting_staff", attention: true })).toBe("needs_human");
    // Viewed but still unclaimed: nobody has taken it, so it still needs
    // a human even though the attention alert was consumed by viewing.
    expect(deskStatus({ state: "awaiting_staff", attention: false })).toBe("needs_human");
  });

  it("maps unhandled visitor activity to the attention tier", () => {
    expect(deskStatus({ state: "claimed", attention: true })).toBe("attention");
    expect(deskStatus({ state: "bot_active", attention: true })).toBe("attention");
  });

  it("leaves ongoing chats without unread attention in the Active tier", () => {
    expect(deskStatus({ state: "bot_active", attention: false })).toBe("active");
    expect(deskStatus({ state: "claimed", attention: false })).toBe("active");
  });

  it("gives every tier visible text, distinct and non-empty", () => {
    const labels = Object.values(DESK_STATUS_LABELS);
    expect(labels).toHaveLength(3);
    for (const label of labels) {
      expect(label.length).toBeGreaterThan(0);
    }
    expect(new Set(labels).size).toBe(3);
  });
});

describe("attention event identity (ticket 44)", () => {
  it("derives one stable event per attention episode", () => {
    const standing = item({ attention: true, attentionAt: "2026-11-05T09:04:00.000Z" });
    const first = deskAttentionEvents([standing]);
    // Polling re-renders the same episode: the identity must not move.
    const second = deskAttentionEvents([standing]);
    expect(first).toEqual(second);
    expect(first[0]?.id).toBe("conv-1:2026-11-05T09:04:00.000Z");
    expect(first[0]?.conversationId).toBe("conv-1");
  });

  it("excludes conversations without standing attention", () => {
    const quiet = item({ attention: false, attentionAt: null });
    expect(deskAttentionEvents([quiet])).toEqual([]);
  });

  it("raises a fresh identity when a new episode begins", () => {
    const episode = deskAttentionEvents([
      item({ attention: true, attentionAt: "2026-11-05T09:04:00.000Z" }),
    ])[0]!;
    const next = deskAttentionEvents([
      item({ attention: true, attentionAt: "2026-11-05T09:30:00.000Z" }),
    ])[0]!;
    expect(next.id).not.toBe(episode.id);
  });
});

function fakeStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe("attention cue storage (ticket 44)", () => {
  it("sounds once per event and stays quiet on repeated polling snapshots", () => {
    const storage = fakeStorage();
    const cues = createAttentionCues(storage, () => 1_000);
    expect(cues.fresh(["conv-1:t1", "conv-2:t1"])).toEqual(["conv-1:t1", "conv-2:t1"]);
    cues.markSeen(["conv-1:t1", "conv-2:t1"]);
    // The next poll re-delivers the same events; nothing may re-queue.
    expect(cues.fresh(["conv-1:t1", "conv-2:t1"])).toEqual([]);
  });

  it("keeps identities across navigation, reloads, and a second dashboard view", () => {
    const storage = fakeStorage();
    createAttentionCues(storage, () => 1_000).markSeen(["conv-1:t1"]);
    // A fresh component (route change, second tab on the same browser
    // profile) reads the same persisted set.
    const secondView = createAttentionCues(storage, () => 2_000);
    expect(secondView.fresh(["conv-1:t1"])).toEqual([]);
    expect(secondView.fresh(["conv-1:t2"])).toEqual(["conv-1:t2"]);
  });

  it("holds events that cannot sound yet and releases them for one late cue", () => {
    const storage = fakeStorage();
    const cues = createAttentionCues(storage, () => 1_000);
    cues.hold(["conv-1:t1", "conv-2:t1"]);
    // Held events are not forgotten and not re-reported while pending.
    expect(cues.fresh(["conv-1:t1"])).toEqual([]);
    const held = cues.takeHeld();
    expect(held.map((event) => event.id)).toEqual(["conv-1:t1", "conv-2:t1"]);
    // The component marks them seen only once the late cue has fired.
    expect(cues.fresh(["conv-1:t1"])).toEqual(["conv-1:t1"]);
    cues.markSeen(held.map((event) => event.id));
    expect(cues.fresh(["conv-1:t1"])).toEqual([]);
  });

  it("timestamps held events so stale autoplay backlogs can be dropped", () => {
    const storage = fakeStorage();
    let now = 1_000;
    const cues = createAttentionCues(storage, () => now);
    cues.hold(["conv-1:t1"]);
    now += CUE_FRESH_MS * 10;
    const [held] = cues.takeHeld();
    expect(held!.id).toBe("conv-1:t1");
    expect(now - held!.heldAt).toBeGreaterThan(CUE_FRESH_MS);
  });

  it("re-opens ids whose cue was scheduled but never sounded", () => {
    const storage = fakeStorage();
    const cues = createAttentionCues(storage, () => 1_000);
    cues.markSeen(["conv-1:t1"]);
    expect(cues.fresh(["conv-1:t1"])).toEqual([]);
    // The view unmounted inside the burst window and reverted the mark.
    cues.forget(["conv-1:t1"]);
    expect(cues.fresh(["conv-1:t1"])).toEqual(["conv-1:t1"]);
    // Forgetting an unknown id is a harmless no-op.
    expect(() => cues.forget(["conv-9:t9"])).not.toThrow();
  });

  it("persists the mute preference separately from seen events", () => {
    const storage = fakeStorage();
    const cues = createAttentionCues(storage, () => 1_000);
    expect(cues.isMuted()).toBe(false);
    cues.setMuted(true);
    expect(storage.map.get(SOUND_MUTED_KEY)).toBe("1");
    expect(createAttentionCues(storage, () => 2_000).isMuted()).toBe(true);
    cues.setMuted(false);
    expect(createAttentionCues(storage, () => 3_000).isMuted()).toBe(false);
  });

  it("tolerates corrupt or missing storage data", () => {
    const storage = fakeStorage();
    storage.map.set(SEEN_ATTENTION_KEY, "{not json");
    storage.map.set(SOUND_MUTED_KEY, "banana");
    const cues = createAttentionCues(storage, () => 1_000);
    expect(cues.isMuted()).toBe(false);
    expect(cues.fresh(["conv-1:t1"])).toEqual(["conv-1:t1"]);
  });

  it("prunes seen identities past the retention window", () => {
    const storage = fakeStorage();
    const week = 7 * 24 * 60 * 60 * 1000;
    storage.map.set(
      SEEN_ATTENTION_KEY,
      JSON.stringify({ "conv-old:t1": 1_000 - week * 2, "conv-keep:t1": 1_000 - 60 }),
    );
    const cues = createAttentionCues(storage, () => 1_000);
    cues.markSeen(["conv-new:t1"]);
    const seen = JSON.parse(storage.map.get(SEEN_ATTENTION_KEY)!) as Record<string, number>;
    expect(seen["conv-old:t1"]).toBeUndefined();
    expect(seen["conv-keep:t1"]).toBe(1_000 - 60);
    expect(seen["conv-new:t1"]).toBe(1_000);
  });
});

describe("the dashboard sound wiring (ticket 44)", () => {
  it("guards audio construction and coalescing, and exposes a pressed-state toggle", async () => {
    const source = await readFile(
      path.join(repoRoot(), "src/app/dashboard/inbox/attention-sounds.tsx"),
      "utf8",
    );
    // Playback and context construction can fail (headless browsers, missing
    // audio devices): every failure path is caught so polling never breaks.
    expect(source).toMatch(/try \{[\s\S]*new AudioContext/);
    expect(source).toMatch(/catch/);
    // The mute control is a real toggle with an accessible pressed state.
    expect(source).toContain("aria-pressed");
    // Autoplay-blocked audio arms itself on the staff member's first
    // interaction instead of throwing or looping.
    expect(source).toContain("pointerdown");
    // One burst of attention events coalesces into a single scheduled cue.
    expect(source).toContain("burstTimer");
  });
});
