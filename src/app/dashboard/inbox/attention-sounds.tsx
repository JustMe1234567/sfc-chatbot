"use client";

import { useEffect, useRef, useState } from "react";
import {
  CUE_FRESH_MS,
  createAttentionCues,
  type AttentionCues,
  type StorageLike,
} from "@/domain/attentionCues";
import type { AttentionEvent } from "@/domain/inbox";
import styles from "../dashboard.module.css";

/**
 * The desk's notification sound (ticket 44): one short cue when a
 * conversation newly needs staff attention, at most once per event per
 * staff browser. The event identities arrive from the server on every poll
 * (ticket 12's refresh cycle); this component diffs them against the
 * persisted seen-set, so polling, re-rendering, navigation, and a second
 * view can never re-queue an episode. Playback is Web Audio — no asset, and
 * every failure path is caught, because a broken audio stack must never
 * break inbox polling. The visual indicators render server-side and are
 * unaffected by muting.
 */

/** Adjacent polls delivering different events coalesce into one cue. */
const BURST_MS = 400;

/** The two soft tones of the cue: a front-desk ding, under half a second. */
const CHIME_NOTES: [offsetSeconds: number, frequencyHz: number][] = [
  [0, 880],
  [0.16, 1174.66],
];

/** Gestures that unlock audio under autoplay policies. */
const GESTURES = ["pointerdown", "keydown", "touchstart"] as const;

/** The tracker guards every storage call itself (a full or blocked store
 *  degrades to per-render dedup), so this is a bare window handle — and
 *  even `window.localStorage` access throwing is caught there. */
function safeStorage(): StorageLike {
  return {
    getItem(key) {
      return window.localStorage.getItem(key);
    },
    setItem(key, value) {
      window.localStorage.setItem(key, value);
    },
  };
}

export default function AttentionSounds({ events }: { events: AttentionEvent[] }) {
  const [muted, setMuted] = useState(false);
  const cuesRef = useRef<AttentionCues | null>(null);
  const mutedRef = useRef(false);
  const contextRef = useRef<AudioContext | null>(null);
  const armedRef = useRef(false);
  const burstTimerRef = useRef<number | null>(null);
  const chimeEndsAtRef = useRef(0);
  const gestureHandlerRef = useRef<(() => void) | null>(null);
  // Events whose chime is scheduled but has not fired yet. They count as
  // seen only once the sound actually plays (or fails) — otherwise a view
  // unmounting inside the burst window would swallow its cue for good.
  const queuedRef = useRef<Set<string>>(new Set());

  function cues(): AttentionCues {
    if (!cuesRef.current) cuesRef.current = createAttentionCues(safeStorage());
    return cuesRef.current;
  }

  function ensureContext(): AudioContext | null {
    if (typeof window === "undefined" || typeof window.AudioContext === "undefined") {
      return null;
    }
    try {
      if (contextRef.current && contextRef.current.state === "closed") {
        contextRef.current = null;
      }
      if (!contextRef.current) contextRef.current = new AudioContext();
      return contextRef.current;
    } catch {
      return null;
    }
  }

  function playChime(context: AudioContext): number {
    const start = context.currentTime + 0.01;
    const master = context.createGain();
    master.gain.value = 0.16;
    master.connect(context.destination);
    let endsAt = start;
    for (const [offset, frequency] of CHIME_NOTES) {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(1, start + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.34);
      osc.connect(gain);
      gain.connect(master);
      osc.start(start + offset);
      osc.stop(start + offset + 0.36);
      endsAt = Math.max(endsAt, start + offset + 0.36);
    }
    return Date.now() + Math.max(0, (endsAt - context.currentTime) * 1000);
  }

  function scheduleChime(context: AudioContext, ids: string[]): void {
    // Seen at schedule time, not play time: another open view polling the
    // same event must find it taken before its own watcher fires. One
    // burst of events is one cue — later arrivals join the scheduled
    // batch, and a just-played chime delays the next instead of
    // overlapping it.
    cues().markSeen(ids);
    for (const id of ids) queuedRef.current.add(id);
    if (burstTimerRef.current !== null) return;
    const wait = Math.max(BURST_MS, chimeEndsAtRef.current - Date.now());
    burstTimerRef.current = window.setTimeout(() => {
      burstTimerRef.current = null;
      queuedRef.current.clear();
      try {
        chimeEndsAtRef.current = playChime(context);
      } catch {
        // Playback failure must never break polling or interaction.
      }
    }, wait);
  }

  /** Autoplay policies block audio until the staff member interacts: arm
   *  the first gesture to unlock, then play one late cue for what is still
   *  fresh instead of a backlog blast. */
  function armFirstGesture(context: AudioContext): void {
    if (armedRef.current) return;
    armedRef.current = true;
    const onGesture = () => {
      armedRef.current = false;
      gestureHandlerRef.current = null;
      for (const type of GESTURES) window.removeEventListener(type, onGesture);
      context
        .resume()
        .then(() => {
          const tracker = cues();
          const held = tracker.takeHeld();
          if (held.length === 0) return;
          if (held.some((event) => Date.now() - event.heldAt < CUE_FRESH_MS)) {
            scheduleChime(context, held.map((event) => event.id));
          } else {
            // A stale backlog is not news anymore: seen, silent, and the
            // visual indicators already carried it.
            tracker.markSeen(held.map((event) => event.id));
          }
        })
        .catch(() => {
          // Resume refused: the events stay unmarked, and the visual
          // indicators carry them until a later gesture retries.
        });
    };
    gestureHandlerRef.current = onGesture;
    for (const type of GESTURES) window.addEventListener(type, onGesture, { passive: true });
  }

  // Read the persisted preference after hydration so the server HTML and
  // the first client render agree.
  useEffect(() => {
    const tracker = cues();
    mutedRef.current = tracker.isMuted();
    setMuted(mutedRef.current);
    return () => {
      if (burstTimerRef.current !== null) window.clearTimeout(burstTimerRef.current);
      burstTimerRef.current = null;
      const handler = gestureHandlerRef.current;
      if (handler) {
        for (const type of GESTURES) window.removeEventListener(type, handler);
      }
      // A cue scheduled but not yet fired was already marked seen (cross-
      // view dedup) — revert that, or leaving mid-burst would swallow the
      // event's only cue. The next sighting schedules it again.
      const queued = [...queuedRef.current];
      queuedRef.current.clear();
      if (queued.length > 0) cues().forget(queued);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const tracker = cues();
    const fresh = tracker.fresh(events.map((event) => event.id));
    if (fresh.length === 0) return;
    if (mutedRef.current) {
      // Muted ears still get marked events: no loops, and the visual
      // indicators are untouched.
      tracker.markSeen(fresh);
      return;
    }
    const context = ensureContext();
    if (!context) {
      // No Web Audio at all: the visual indicators carry the event.
      tracker.markSeen(fresh);
      return;
    }
    if (context.state === "running") {
      scheduleChime(context, fresh);
      return;
    }
    tracker.hold(fresh);
    armFirstGesture(context);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  function toggleMuted(): void {
    const tracker = cues();
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    tracker.setMuted(next);
    if (next) {
      // Muting consumes any autoplay-blocked backlog so it cannot blast
      // the moment audio unlocks.
      tracker.markSeen(tracker.takeHeld().map((event) => event.id));
    }
  }

  return (
    <button
      type="button"
      className={styles.soundToggle}
      aria-pressed={!muted}
      onClick={toggleMuted}
      title="Plays one short cue when a chat needs staff attention"
    >
      <span aria-hidden="true">{muted ? "🔇" : "🔔"}</span>
      Notification sounds {muted ? "off" : "on"}
    </button>
  );
}
