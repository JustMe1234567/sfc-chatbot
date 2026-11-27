/**
 * The staff-side state behind the dashboard notification sound (tickets
 * 44, 77, and 106): which attention events this browser has already cued,
 * whether the staff member muted the sound, and — since ticket 106 — the
 * needs-human ring's timing and motif. State lives in localStorage so the
 * identity survives navigation, reloads, and a second dashboard view: an
 * ordinary attention event still sounds at most once per staff browser,
 * and polling can never re-queue it, while the louder needs-human ring
 * loops on a timer for as long as a conversation needs a human.
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

/** The needs-human ring's louder master gain (tickets 77 and 106), up
 *  from the 0.16 one-shot cue so the desk is heard across a room. */
export const ALERT_GAIN = 0.5;

/** Ordinary new-message attention keeps 44's softer one-shot gain. */
export const CUE_GAIN = 0.16;

/** The needs-human ring's motif (ticket 106, the owner's 2026-11-27 triage
 *  pick): the "Marimba greeting" — a triangle-wave arpeggio of C5 523.25
 *  Hz, E5 659.25 Hz, and G5 783.99 Hz whose three-note phrase repeats
 *  once. Offsets are seconds from the play's start; the first three notes
 *  sound at 0 / 0.15 / 0.30 and the phrase repeats at +0.60. */
export const RING_NOTES: [offsetSeconds: number, frequencyHz: number][] = [
  [0, 523.25],
  [0.15, 659.25],
  [0.3, 783.99],
  [0.9, 523.25],
  [1.05, 659.25],
  [1.2, 783.99],
];

/** Each struck note ramps from silence to full over 6 ms. */
export const ALERT_NOTE_ATTACK_SECONDS = 0.006;

/** ...and decays exponentially back to silence over 0.38 seconds from its
 *  onset — the struck-marimba ring-out. */
export const ALERT_NOTE_RING_SECONDS = 0.38;

/** The motif's sounded length: the last note ends 1.58 seconds after the
 *  play starts (its 1.2-second onset plus the 0.38-second ring-out) —
 *  ≈ 1.6 seconds of sound per play. */
export const ALERT_SOUNDED_SECONDS = 1.58;

/** The continuous ring's breath (the owner's 2026-11-27 override of
 *  ticket 77's 30-second repeat): the next play starts exactly this long
 *  after the previous play's sounded end — start-to-start ≈ 2.1 seconds,
 *  a phrase-then-breath loop that reads as a phone ringing. */
export const ALERT_BREATH_MS = 500;

/**
 * When the next ring play begins (ticket 106): exactly one breath after
 * the previous play's sounded end. A play therefore never overlaps or
 * cuts short its successor, and the loop's rhythm follows the actual
 * sounded end rather than the play's start.
 */
export function nextRingAt(soundedUntil: number): number {
  return soundedUntil + ALERT_BREATH_MS;
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

/** One beat's play: the instant (Date.now ms) it stops sounding, or null
 *  when playback failed — a failed beat still keeps the loop's schedule. */
export type AlertPlay = number | null;

/**
 * The continuous needs-human ring (ticket 106, superseding ticket 77's
 * 30-second repeat): a play starts as soon as the air is quiet, and the
 * next one begins exactly one breath after the previous play's sounded
 * end — for as long as `shouldSound()` stays true. Every beat re-checks
 * before sounding, so a mute or a cleared needs-human state ends the loop
 * without a stray play, and no beat starts while another cue or alert is
 * still in flight. The timing here owns no audio: `play()` performs one
 * play and stopping a sounding one is the caller's `stop()`, which only
 * cancels the next scheduled beat. Timer plumbing is injectable so the
 * rhythm is testable without a real clock.
 */
export interface AlertCycleOptions {
  /** Play one beat now. Returns when it stops sounding, or null when
   *  playback failed. */
  play(): AlertPlay;
  /** Whether a play may sound right now: false ends the loop. */
  shouldSound(): boolean;
  /** When any still-sounding cue or alert ends (Date.now ms) — in the
   *  past when the air is quiet. A beat never starts earlier. */
  quietAt(): number;
  schedule(handler: () => void, waitMs: number): number;
  cancel(handle: number): void;
  now(): number;
}

export interface AlertCycle {
  /** Begin the loop. Starting an already-beating loop changes nothing. */
  start(): void;
  /** Adopt a play that just started outside the loop — a coalesced burst
   *  cue that doubled as the first beat: the next beat begins one breath
   *  after it stops sounding. Ignored while a beat is already pending,
   *  so the loop keeps its own rhythm. */
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
      // Something is still sounding — never overlap it; start the play
      // from a quiet moment instead.
      beat = schedule(runBeat, quiet - now());
      return;
    }
    const startedAt = now();
    const soundedUntil = play();
    const nextAt = nextRingAt(soundedUntil ?? startedAt);
    beat = schedule(runBeat, Math.max(0, nextAt - now()));
  }

  return {
    start() {
      if (beat !== null) return;
      runBeat();
    },
    adopt(soundedUntil) {
      if (beat !== null) return;
      const nextAt = nextRingAt(soundedUntil);
      beat = schedule(runBeat, Math.max(0, nextAt - now()));
    },
    stop() {
      clearBeat();
    },
  };
}
