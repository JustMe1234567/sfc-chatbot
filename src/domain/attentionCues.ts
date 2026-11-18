/**
 * The staff-side state behind the dashboard notification sound (tickets 44
 * and 77): which attention events this browser has already cued, whether
 * the staff member muted the sound, and — since ticket 77 — the repeating
 * needs-human alert cycle's timing. State lives in localStorage so the
 * identity survives navigation, reloads, and a second dashboard view: an
 * ordinary attention event still sounds at most once per staff browser,
 * and polling can never re-queue it, while the louder needs-human alert
 * repeats on a timer for as long as a conversation needs a human.
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

/** The two soft tones of the cue: a front-desk ding. */
export const CHIME_NOTES: [offsetSeconds: number, frequencyHz: number][] = [
  [0, 880],
  [0.16, 1174.66],
];

/** How long one note rings out after its onset, in seconds. */
export const NOTE_RING_SECONDS = 0.36;

/** The needs-human alert's louder master gain (ticket 77), up from the
 *  0.16 one-shot cue so the desk is heard across a room. */
export const ALERT_GAIN = 0.5;

/** Ordinary new-message attention keeps 44's softer one-shot gain. */
export const CUE_GAIN = 0.16;

/** The repeating needs-human alert's spacing (ticket 77): 30 seconds from
 *  the start of one alert to the start of the next. */
export const ALERT_REPEAT_MS = 30_000;

/** The longest an alert may sound (ticket 77): well above the two-note
 *  chime it bounds, and far below the 30-second spacing, so alerts can
 *  never overlap their successors. */
export const ALERT_MAX_MS = 6_000;

/**
 * When the next repeating alert may begin (ticket 77): 30 seconds after
 * the current alert started, measured start to start — and never before
 * the alert has stopped sounding, with that end capped at the 6-second
 * maximum so even an over-long sound cannot delay or overlap its
 * successor.
 */
export function nextAlertAt(alertStartedAt: number, soundedUntil: number): number {
  const cappedEnd = Math.min(soundedUntil, alertStartedAt + ALERT_MAX_MS);
  return Math.max(alertStartedAt + ALERT_REPEAT_MS, cappedEnd);
}

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

/** One beat's alert: the instant (Date.now ms) it stops sounding, or null
 *  when playback failed — a failed beat still keeps the cycle's schedule. */
export type AlertPlay = number | null;

/**
 * One repeating needs-human alert cycle (ticket 77): an alert starts as
 * soon as the air is quiet, then another begins every 30 seconds —
 * measured from the start of one alert to the start of the next — for as
 * long as `shouldSound()` stays true. Every beat re-checks before
 * sounding, so a mute or a cleared needs-human state ends the cycle
 * without a stray alert, and no beat starts while another cue or alert is
 * still in flight. The timing here owns no audio: `play()` performs one
 * alert and stopping a sounding one is the caller's `stop()`, which only
 * cancels the next scheduled beat. Timer plumbing is injectable so the
 * rhythm is testable without a real clock.
 */
export interface AlertCycleOptions {
  /** Play one alert now. Returns when it stops sounding, or null when
   *  playback failed. */
  play(): AlertPlay;
  /** Whether an alert may sound right now: false ends the cycle. */
  shouldSound(): boolean;
  /** When any still-sounding cue or alert ends (Date.now ms) — in the
   *  past when the air is quiet. A beat never starts earlier. */
  quietAt(): number;
  schedule(handler: () => void, waitMs: number): number;
  cancel(handle: number): void;
  now(): number;
}

export interface AlertCycle {
  /** Begin the cycle. Starting an already-beating cycle changes nothing. */
  start(): void;
  /** Adopt an alert that just started outside the cycle — a coalesced
   *  burst cue that doubled as the first beat: the next beat begins 30
   *  seconds after it started. Ignored while a beat is already pending,
   *  so the cycle keeps its own rhythm. */
  adopt(soundedUntil: number): void;
  /** Cancel the next scheduled beat. Stopping twice is harmless. */
  stop(): void;
}

export function createAlertCycle(options: AlertCycleOptions): AlertCycle {
  const { play, shouldSound, quietAt, schedule, cancel, now } = options;
  let beat: number | null = null;

  function clearBeat(): void {
    if (beat !== null) {
      cancel(beat);
      beat = null;
    }
  }

  function runBeat(): void {
    beat = null;
    if (!shouldSound()) return;
    const quiet = quietAt();
    if (quiet > now()) {
      // Something is still sounding — never overlap it; start the alert
      // from a quiet moment instead.
      beat = schedule(runBeat, quiet - now());
      return;
    }
    const startedAt = now();
    const soundedUntil = play();
    const nextAt = nextAlertAt(startedAt, soundedUntil ?? startedAt);
    beat = schedule(runBeat, Math.max(0, nextAt - now()));
  }

  return {
    start() {
      if (beat !== null) return;
      runBeat();
    },
    adopt(soundedUntil) {
      if (beat !== null) return;
      const nextAt = nextAlertAt(now(), soundedUntil);
      beat = schedule(runBeat, Math.max(0, nextAt - now()));
    },
    stop() {
      clearBeat();
    },
  };
}
