"use client";

import { useEffect, useRef, useState } from "react";
import {
  ALERT_GAIN,
  CHIME_NOTES,
  CUE_FRESH_MS,
  CUE_GAIN,
  NOTE_RING_SECONDS,
  createAlertCycle,
  createAttentionCues,
  type AlertCycle,
  type AttentionCues,
  type StorageLike,
} from "@/domain/attentionCues";
import type { AttentionEvent } from "@/domain/inbox";
import styles from "../dashboard.module.css";

/**
 * The desk's notification sound (tickets 44 and 77): a louder alert that
 * repeats every 30 seconds while at least one live desk conversation
 * remains in Needs human — starting the moment the state appears or audio
 * unlocks, stopping the moment the last waiting conversation is taken over
 * or otherwise leaves the state, and killed instantly by muting. Ordinary
 * new-message attention and contact requests keep 44's one-cue behavior at
 * the softer gain, even while the alarm runs. The needs-human cycle is
 * driven by the desk's state, not by events, so every waiting conversation
 * shares one cycle and no waiting count can stack alerts; a cue whose
 * batch contains an escalation is that alert. The event identities for the
 * one-cue path still arrive from the server on every poll (ticket 12's
 * refresh cycle); this component diffs them against the persisted
 * seen-set, so polling, re-rendering, navigation, and a second view can
 * never re-queue an episode. Playback is Web Audio — no asset, and every
 * failure path is caught, because a broken audio stack must never break
 * inbox polling. The visual indicators render server-side and are
 * unaffected by muting.
 */

/** Adjacent polls delivering different events coalesce into one cue. */
const BURST_MS = 400;

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

export default function AttentionSounds({
  events,
  needsHumanIds,
}: {
  events: AttentionEvent[];
  /** The live desk conversations in Needs human (ticket 77): the repeating
   *  alert runs while this list is non-empty, and an attention event whose
   *  conversation is on it sounds as the louder alert. */
  needsHumanIds: string[];
}) {
  const needsHuman = needsHumanIds.length > 0;
  const [muted, setMuted] = useState(false);
  const cuesRef = useRef<AttentionCues | null>(null);
  const mutedRef = useRef(false);
  const needsHumanRef = useRef(false);
  const contextRef = useRef<AudioContext | null>(null);
  const armedRef = useRef(false);
  const burstTimerRef = useRef<number | null>(null);
  const alertCycleRef = useRef<AlertCycle | null>(null);
  const chimeEndsAtRef = useRef(0);
  const currentSoundRef = useRef<{ stop(): void; isAlert: boolean } | null>(null);
  const gestureHandlerRef = useRef<(() => void) | null>(null);
  // Events whose chime is scheduled but has not fired yet. They count as
  // seen only once the sound actually plays (or fails) — otherwise a view
  // unmounting inside the burst window would swallow its cue for good.
  const queuedRef = useRef<Set<string>>(new Set());
  // Whether the pending burst's batch contains a Needs-human escalation
  // (ticket 77): the coalesced cue is then that louder alert, and later
  // arrivals joining the batch keep the flag ORed in.
  const queuedNeedsHumanRef = useRef(false);

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

  function playChime(context: AudioContext, gain: number, isAlert: boolean): number {
    const start = context.currentTime + 0.01;
    const master = context.createGain();
    master.gain.value = gain;
    master.connect(context.destination);
    // The handle muting and a cleared needs-human state use to stop the
    // sounding alert immediately (ticket 77): disconnecting kills every
    // oscillator this cue scheduled at once. Only alerts carry it — an
    // ordinary cue always rings out, as in ticket 44.
    currentSoundRef.current = {
      isAlert,
      stop: () => {
        try {
          master.disconnect();
        } catch {
          // A closing context is already silent.
        }
      },
    };
    let endsAt = start;
    for (const [offset, frequency] of CHIME_NOTES) {
      const osc = context.createOscillator();
      const gainNode = context.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      gainNode.gain.setValueAtTime(0.0001, start + offset);
      gainNode.gain.exponentialRampToValueAtTime(1, start + offset + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, start + offset + NOTE_RING_SECONDS);
      osc.connect(gainNode);
      gainNode.connect(master);
      osc.start(start + offset);
      osc.stop(start + offset + NOTE_RING_SECONDS);
      endsAt = Math.max(endsAt, start + offset + NOTE_RING_SECONDS);
    }
    return Date.now() + Math.max(0, (endsAt - context.currentTime) * 1000);
  }

  function stopCurrentSound(): void {
    currentSoundRef.current?.stop();
    currentSoundRef.current = null;
  }

  /** Only needs-human alerts are ever stopped mid-flight (ticket 77); an
   *  ordinary cue keeps 44's ring-out even when the desk state clears or
   *  the staff member mutes mid-cue. */
  function stopAlertSound(): void {
    if (currentSoundRef.current?.isAlert) stopCurrentSound();
  }

  /** The repeating needs-human alert (ticket 77): the domain cycle keeps
   *  the 30-second rhythm; playback resolves the live context so a
   *  recycled AudioContext cannot strand the cycle on a dead one. */
  function alertCycle(): AlertCycle {
    if (!alertCycleRef.current) {
      alertCycleRef.current = createAlertCycle({
        play: () => {
          const context = contextRef.current;
          if (!context) return null;
          try {
            chimeEndsAtRef.current = playChime(context, ALERT_GAIN, true);
            return chimeEndsAtRef.current;
          } catch {
            // Playback failure must never break polling or interaction;
            // the cycle keeps its schedule and retries on the next beat.
            return null;
          }
        },
        shouldSound: () => !mutedRef.current && needsHumanRef.current,
        quietAt: () => chimeEndsAtRef.current,
        schedule: (handler, waitMs) => window.setTimeout(handler, waitMs),
        cancel: (handle) => window.clearTimeout(handle),
        now: () => Date.now(),
      });
    }
    return alertCycleRef.current;
  }

  function startAlertCycle(): void {
    const context = ensureContext();
    // A suspended context would schedule silent alerts that all fire at
    // once on resume; the cycle starts from the unlock path instead.
    if (!context || context.state !== "running") return;
    alertCycle().start();
  }

  /** Stop the current alert and cancel the next repeat immediately
   *  (ticket 77). The instant stop covers only alerts: an ordinary cue
   *  caught mid-flight rings out as in ticket 44. */
  function stopAlertCycle(): void {
    alertCycleRef.current?.stop();
    stopAlertSound();
  }

  function fireBurst(context: AudioContext): void {
    burstTimerRef.current = null;
    queuedRef.current.clear();
    if (mutedRef.current) return; // muted since scheduling: stay silent
    try {
      // The batch decides the volume (ticket 77): a cue whose batch
      // contains a Needs-human escalation is that louder alert; ordinary
      // attention keeps 44's softer gain even mid-alarm.
      chimeEndsAtRef.current = playChime(
        context,
        queuedNeedsHumanRef.current ? ALERT_GAIN : CUE_GAIN,
        queuedNeedsHumanRef.current,
      );
    } catch {
      // Playback failure must never break polling or interaction.
    }
    if (queuedNeedsHumanRef.current) {
      // This louder alert is the cycle's current beat: the next repeat
      // begins 30 seconds after it started (ticket 77).
      alertCycle().adopt(chimeEndsAtRef.current);
    }
    queuedNeedsHumanRef.current = false;
  }

  function scheduleChime(context: AudioContext, ids: string[], anyNeedsHuman: boolean): void {
    // Seen at schedule time, not play time: another open view polling the
    // same event must find it taken before its own watcher fires. One
    // burst of events is one cue — later arrivals join the scheduled
    // batch, and a just-played chime delays the next instead of
    // overlapping it.
    cues().markSeen(ids);
    for (const id of ids) queuedRef.current.add(id);
    if (anyNeedsHuman) queuedNeedsHumanRef.current = true;
    if (burstTimerRef.current !== null) return;
    const wait = Math.max(BURST_MS, chimeEndsAtRef.current - Date.now());
    burstTimerRef.current = window.setTimeout(() => {
      // Re-check at fire time: a cycle beat or another cue may have
      // started since this burst was scheduled — never overlap it.
      const fireWait = Math.max(0, chimeEndsAtRef.current - Date.now());
      if (fireWait > 0) {
        burstTimerRef.current = window.setTimeout(() => fireBurst(context), fireWait);
        return;
      }
      fireBurst(context);
    }, wait);
  }

  /** Autoplay policies block audio until the staff member interacts: arm
   *  the first gesture to unlock, then play one late cue for what is still
   *  fresh instead of a backlog blast — or, when the desk needs a human,
   *  start the repeating alert (ticket 77). */
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
          if (needsHumanRef.current && !mutedRef.current) {
            // The alert cycle's immediate louder alert is also the late
            // cue for anything held while audio was blocked: the state is
            // present now, stale or not.
            cues().markSeen(cues().takeHeld().map((event) => event.id));
            startAlertCycle();
            return;
          }
          const tracker = cues();
          const held = tracker.takeHeld();
          if (held.length === 0) return;
          if (held.some((event) => Date.now() - event.heldAt < CUE_FRESH_MS)) {
            scheduleChime(context, held.map((event) => event.id), false);
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
    // Unlock Web Audio on the first ordinary dashboard gesture, before an
    // alert arrives. Creating the context only after an event leaves Brave
    // waiting for a second gesture while the new conversation appears
    // silently even though the control says sounds are on.
    if (!mutedRef.current) {
      const context = ensureContext();
      if (context && context.state !== "running") armFirstGesture(context);
    }
    return () => {
      if (burstTimerRef.current !== null) window.clearTimeout(burstTimerRef.current);
      burstTimerRef.current = null;
      // Leaving the desk cancels the repeating alert (ticket 77) and kills
      // any alert still in flight — another view runs its own cycle. An
      // ordinary cue rings out, as in ticket 44.
      alertCycleRef.current?.stop();
      alertCycleRef.current = null;
      stopAlertSound();
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
      // A fresh event whose conversation is in Needs human (ticket 77)
      // makes this batch the louder alert; ordinary attention stays soft.
      const waiting = new Set(needsHumanIds);
      const conversationOf = new Map(
        events.map((event) => [event.id, event.conversationId]),
      );
      const anyNeedsHuman = fresh.some((id) =>
        waiting.has(conversationOf.get(id) ?? ""),
      );
      scheduleChime(context, fresh, anyNeedsHuman);
      return;
    }
    tracker.hold(fresh);
    armFirstGesture(context);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  // The needs-human alert follows the desk's state (ticket 77), so it
  // starts, stops, and restarts with the prop rather than waiting for new
  // attention events.
  useEffect(() => {
    needsHumanRef.current = needsHuman;
    if (!needsHuman || mutedRef.current) {
      stopAlertCycle();
      return;
    }
    const context = ensureContext();
    if (!context) return; // no Web Audio at all: visual indicators carry it
    if (context.state === "running") {
      // A cue about to sound anchors its own first beat (the burst path
      // adopts it); otherwise start immediately.
      if (burstTimerRef.current === null) startAlertCycle();
      return;
    }
    // Autoplay-blocked: unlock on the staff member's first interaction,
    // and the cycle starts then.
    armFirstGesture(context);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsHuman]);

  function toggleMuted(): void {
    const tracker = cues();
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    tracker.setMuted(next);
    if (next) {
      // Muting stops the current alert and cancels repeats immediately
      // (ticket 77), cancels any burst yet to fire, and consumes any
      // autoplay-blocked backlog so it cannot blast the moment audio
      // unlocks. Muted ears keep their marked events (ticket 44).
      stopAlertCycle();
      if (burstTimerRef.current !== null) {
        window.clearTimeout(burstTimerRef.current);
        burstTimerRef.current = null;
      }
      queuedRef.current.clear();
      queuedNeedsHumanRef.current = false;
      tracker.markSeen(tracker.takeHeld().map((event) => event.id));
    } else if (needsHumanRef.current) {
      // Unmuting while a conversation still needs a human restarts the
      // alert cycle now, without waiting for another conversation event
      // (ticket 77).
      const context = ensureContext();
      if (!context) return;
      if (context.state === "running") startAlertCycle();
      else armFirstGesture(context);
    }
  }

  return (
    <div>
      <button
        type="button"
        className={styles.soundToggle}
        aria-pressed={!muted}
        onClick={toggleMuted}
        title="Repeats a louder alert while a conversation needs staff attention; new messages cue once"
      >
        <span aria-hidden="true">{muted ? "🔇" : "🔔"}</span>
        Notification sounds {muted ? "off" : "on"}
      </button>
    </div>
  );
}
