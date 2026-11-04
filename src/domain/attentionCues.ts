/**
 * The staff-side state behind the dashboard notification sound (ticket 44):
 * which attention events this browser has already cued, and whether the
 * staff member muted the sound. Both live in localStorage so the identity
 * survives navigation, reloads, and a second dashboard view — an event
 * sounds at most once per staff browser, and polling can never re-queue it.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SEEN_ATTENTION_KEY = "sfc-dashboard-seen-attention";
export const SOUND_MUTED_KEY = "sfc-dashboard-sound-muted";

/** Seen identities outlive the episodes they name (a day-old conversation
 *  leaves the desk entirely); the window only bounds storage growth. */
export const SEEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** How long a held cue (autoplay-blocked) stays worth playing once audio
 *  unlocks: past this the visual indicators alone carry the event. */
export const CUE_FRESH_MS = 60_000;

function readSeen(storage: StorageLike): Record<string, number> {
  try {
    const raw = storage.getItem(SEEN_ATTENTION_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const seen: Record<string, number> = {};
    for (const [id, at] of Object.entries(parsed)) {
      if (typeof at === "number" && Number.isFinite(at)) seen[id] = at;
    }
    return seen;
  } catch {
    return {};
  }
}

export interface AttentionCues {
  /** Which of these ids this browser has not handled yet (never seen, not
   *  currently held for a late cue). */
  fresh(ids: string[]): string[];
  /** Record ids as handled. Merges with what is stored and prunes entries
   *  past the retention window. */
  markSeen(ids: string[]): void;
  /** Undo markSeen for ids whose cue was scheduled but never sounded — a
   *  view unmounting inside the burst window — so the next sighting can
   *  still cue them. */
  forget(ids: string[]): void;
  /** Park events that cannot sound yet (autoplay-blocked audio). Held ids
   *  stay out of fresh() but unmarked, so the late cue can decide. */
  hold(ids: string[]): void;
  /** Release held events with the instant each was parked. */
  takeHeld(): { id: string; heldAt: number }[];
  isMuted(): boolean;
  setMuted(muted: boolean): void;
}

export function createAttentionCues(
  storage: StorageLike,
  now: () => number = Date.now,
): AttentionCues {
  const held = new Map<string, number>();
  return {
    fresh(ids) {
      const seen = readSeen(storage);
      return ids.filter((id) => !(id in seen) && !held.has(id));
    },
    markSeen(ids) {
      const seen = readSeen(storage);
      const t = now();
      for (const id of ids) {
        seen[id] = t;
        held.delete(id);
      }
      for (const [id, at] of Object.entries(seen)) {
        if (t - at > SEEN_TTL_MS) delete seen[id];
      }
      try {
        storage.setItem(SEEN_ATTENTION_KEY, JSON.stringify(seen));
      } catch {
        // A full or blocked store must not break the desk: the cue state
        // degrades to per-render dedup and sounds stay restrained.
      }
    },
    forget(ids) {
      const seen = readSeen(storage);
      let changed = false;
      for (const id of ids) {
        if (id in seen) {
          delete seen[id];
          changed = true;
        }
        held.delete(id);
      }
      if (!changed) return;
      try {
        storage.setItem(SEEN_ATTENTION_KEY, JSON.stringify(seen));
      } catch {
        // Losing the un-mark only risks a repeat, never a lost cue.
      }
    },
    hold(ids) {
      const t = now();
      for (const id of ids) held.set(id, t);
    },
    takeHeld() {
      const released = [...held.entries()].map(([id, heldAt]) => ({ id, heldAt }));
      held.clear();
      return released;
    },
    isMuted() {
      try {
        return storage.getItem(SOUND_MUTED_KEY) === "1";
      } catch {
        return false;
      }
    },
    setMuted(muted) {
      try {
        storage.setItem(SOUND_MUTED_KEY, muted ? "1" : "0");
      } catch {
        // Preference loss reverts to the unmuted default; never fatal.
      }
    },
  };
}
