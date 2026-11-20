import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ALERT_GAIN,
  ALERT_MAX_MS,
  ALERT_REPEAT_MS,
  BUZZ_COUNT,
  BUZZ_FREQUENCY_HZ,
  BUZZ_OFF_MS,
  BUZZ_ON_MS,
  CHIME_NOTES,
  CUE_GAIN,
  NOTE_RING_SECONDS,
  createAlertCycle,
  nextAlertAt,
} from "../src/domain/attentionCues";
import { repoRoot } from "../src/paths";

/**
 * Ticket 77: the desk's louder, repeating needs-human alert. The alert is
 * a buzzer — one-second buzzes on and off across a 6-second window — at a
 * 0.5 master gain (up from 44's 0.16), starting when a live desk
 * conversation enters Needs human, repeating every 30 seconds from the
 * start of one alert to the start of the next while the state remains,
 * never overlapping another sound, and stopping — current alert and future
 * repeats — the moment the state clears or sounds are muted. Unmuting with
 * a conversation still waiting starts a new cycle without waiting for
 * another event. Ordinary new-message attention keeps 44's one-cue
 * behavior at the softer chime gain. The ticket's original
 * test-notification control was removed at the user's 2026-11-19 review.
 */

/** A manual clock: handlers fire in time order as the test advances, so
 *  the 30-second rhythm is observed without real waiting. */
function manualClock() {
  let now = 0;
  let nextHandle = 1;
  const pending = new Map<number, { at: number; handler: () => void }>();
  return {
    now: () => now,
    schedule: (handler: () => void, waitMs: number): number => {
      const handle = nextHandle++;
      pending.set(handle, { at: now + Math.max(0, waitMs), handler });
      return handle;
    },
    cancel: (handle: number) => {
      pending.delete(handle);
    },
    advance(ms: number): void {
      const target = now + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].handler();
      }
      now = target;
    },
    pending: () => pending.size,
  };
}

function alertHarness(options: { failPlay?: boolean } = {}) {
  const clock = manualClock();
  const playedAt: number[] = [];
  let soundable = true;
  let quiet = -1;
  const cycle = createAlertCycle({
    play: () => {
      if (options.failPlay) return null;
      playedAt.push(clock.now());
      // Each alert "sounds" for half a second.
      return clock.now() + 500;
    },
    shouldSound: () => soundable,
    quietAt: () => quiet,
    schedule: clock.schedule,
    cancel: clock.cancel,
    now: clock.now,
  });
  return {
    clock,
    cycle,
    playedAt,
    setSoundable(value: boolean) {
      soundable = value;
    },
    setQuietAt(at: number) {
      quiet = at;
    },
  };
}

describe("the repeating needs-human alert (ticket 77)", () => {
  it("uses the louder 0.5 alert gain and keeps the ordinary cue at 0.16", () => {
    expect(ALERT_GAIN).toBe(0.5);
    expect(CUE_GAIN).toBe(0.16);
  });

  it("repeats every 30 seconds from the start of one alert to the start of the next", () => {
    expect(ALERT_REPEAT_MS).toBe(30_000);
    const { cycle, clock, playedAt } = alertHarness();
    cycle.start();
    expect(playedAt).toEqual([0]);
    clock.advance(ALERT_REPEAT_MS);
    expect(playedAt).toEqual([0, 30_000]);
    clock.advance(ALERT_REPEAT_MS);
    expect(playedAt).toEqual([0, 30_000, 60_000]);
  });

  it("ends each alert no later than 6 seconds after it starts", () => {
    expect(ALERT_MAX_MS).toBe(6_000);
    // The buzzer's pattern: one-second buzzes separated by one-second
    // silences — the last buzz ends inside the 6-second window.
    expect(BUZZ_ON_MS).toBe(1_000);
    expect(BUZZ_OFF_MS).toBe(1_000);
    expect(BUZZ_COUNT).toBe(3);
    // Buzzes start at 0s, 2s, 4s; the last buzz ends at 5s and the
    // trailing silence closes the pattern at the whole 6-second window.
    expect(
      (BUZZ_COUNT - 1) * (BUZZ_ON_MS + BUZZ_OFF_MS) + BUZZ_ON_MS + BUZZ_OFF_MS,
    ).toBe(ALERT_MAX_MS);
    // The ordinary cue is still the two-note chime, far inside the window.
    const chimeSeconds = Math.max(
      ...CHIME_NOTES.map(([offset]) => offset + NOTE_RING_SECONDS),
    );
    expect(chimeSeconds).toBeLessThanOrEqual(ALERT_MAX_MS / 1000);
  });

  it("keeps the 30-second spacing while an alert still sounds, and caps over-long sounds", () => {
    // nextAlertAt is the beat math: start-to-start 30 seconds, with the
    // sounded end capped at the 6-second maximum so no sound — however
    // long — can delay or overlap its successor.
    expect(nextAlertAt(0, 500)).toBe(30_000);
    expect(nextAlertAt(1_000, 1_000 + 2_000)).toBe(31_000);
    expect(nextAlertAt(0, 60_000)).toBe(30_000);
    expect(nextAlertAt(0, 5_999)).toBe(30_000);
    expect(nextAlertAt(0, 6_000)).toBe(30_000);
  });

  it("never starts a beat while another cue or alert is still sounding", () => {
    const { cycle, clock, playedAt, setQuietAt } = alertHarness();
    setQuietAt(4_000); // an ordinary cue is in flight until t=4000
    cycle.start();
    expect(playedAt).toEqual([]);
    expect(clock.pending()).toBe(1);
    clock.advance(3_999);
    expect(playedAt).toEqual([]);
    clock.advance(1);
    expect(playedAt).toEqual([4_000]);
    // The rhythm runs from the actual start of the first alert.
    clock.advance(30_000);
    expect(playedAt).toEqual([4_000, 34_000]);
  });

  it("ends silently when the state clears between beats and stops re-arming", () => {
    const { cycle, clock, playedAt, setSoundable } = alertHarness();
    cycle.start();
    expect(playedAt).toEqual([0]);
    setSoundable(false); // the last waiting conversation left Needs human
    clock.advance(30_000);
    expect(playedAt).toEqual([0]);
    expect(clock.pending()).toBe(0);
    // With the state still cleared, restarting changes nothing...
    cycle.start();
    expect(clock.pending()).toBe(0);
    // ...but the state returning (a new escalation) sounds again, right now.
    setSoundable(true);
    cycle.start();
    expect(playedAt).toEqual([0, 30_000]);
  });

  it("cancels the next repeat when stopped, and stopping twice is harmless", () => {
    const { cycle, clock, playedAt } = alertHarness();
    cycle.start();
    clock.advance(10_000);
    cycle.stop();
    expect(clock.pending()).toBe(0);
    cycle.stop();
    clock.advance(60_000);
    expect(playedAt).toEqual([0]);
  });

  it("runs one shared cycle however many times it is started", () => {
    // Multiple waiting conversations share one alert cycle: the component
    // holds a single cycle, and a second start must never stack beats.
    const { cycle, clock, playedAt } = alertHarness();
    cycle.start();
    cycle.start();
    cycle.start();
    clock.advance(30_000);
    expect(playedAt).toEqual([0, 30_000]);
    expect(clock.pending()).toBe(1);
  });

  it("keeps the rhythm when playback fails, so audio trouble cannot end the alarm", () => {
    const { cycle, clock, playedAt } = alertHarness({ failPlay: true });
    cycle.start();
    clock.advance(30_000);
    clock.advance(30_000);
    expect(playedAt).toEqual([]);
    expect(clock.pending()).toBe(1);
  });

  it("adopts an out-of-cycle alert as a beat and ignores adoption while one is pending", () => {
    // The coalesced burst cue doubles as the first beat: the next repeat
    // begins 30 seconds after it started.
    const adopted = alertHarness();
    adopted.cycle.adopt(adopted.clock.now() + 500);
    expect(adopted.playedAt).toEqual([]);
    adopted.clock.advance(30_000);
    expect(adopted.playedAt).toEqual([30_000]);
    // Adopting again mid-cycle must not reset the rhythm.
    adopted.clock.advance(10_000);
    adopted.cycle.adopt(adopted.clock.now() + 500);
    adopted.clock.advance(20_000);
    expect(adopted.playedAt).toEqual([30_000, 60_000]);
  });
});

describe("the repeating needs-human alert wiring (ticket 77)", () => {
  const between = (source: string, startMarker: string, endMarker: string): string => {
    const start = source.indexOf(startMarker);
    expect(start, startMarker).toBeGreaterThanOrEqual(0);
    const end = source.indexOf(endMarker, start + startMarker.length);
    expect(end, endMarker).toBeGreaterThanOrEqual(0);
    return source.slice(start, end);
  };

  it("drives one cycle from the live desk's state, whatever the waiting count", async () => {
    const desk = await readFile(
      path.join(repoRoot(), "src/app/dashboard/inbox/conversation-desk.tsx"),
      "utf8",
    );
    // One list for the whole desk — Incoming is exactly the live
    // awaiting_staff list — so two waiting conversations cannot create two
    // cycles, and a viewed-but-unclaimed conversation keeps it running.
    expect(desk).toContain(
      "const needsHumanIds = desk ? desk.incoming.map((item) => item.id) : [];",
    );
    expect(desk).toContain(
      "<AttentionSounds events={attentionEvents} needsHumanIds={needsHumanIds} />",
    );
  });

  it("sounds escalation batches as the buzzer alert and keeps ordinary cues as the soft chime", async () => {
    const source = await readFile(
      path.join(repoRoot(), "src/app/dashboard/inbox/attention-sounds.tsx"),
      "utf8",
    );
    // The cycle's own beats play the buzzer.
    expect(source).toContain("chimeEndsAtRef.current = playBuzzer(context)");
    // A burst cue follows its batch: a batch containing a Needs-human
    // escalation is the buzzer alert, ordinary attention stays at 44's
    // softer chime even mid-alarm.
    expect(source).toContain("? playBuzzer(context)");
    expect(source).toContain(": playChime(context)");
    // The buzz is a square-wave tone — the buzzer character — at the
    // domain's frequency, gated by the on/off pattern constants.
    expect(source).toContain('osc.type = "square"');
    expect(source).toContain("osc.frequency.value = BUZZ_FREQUENCY_HZ");
    expect(source).toContain("BUZZ_ON_MS / 1000");
    expect(source).toContain("(BUZZ_ON_MS + BUZZ_OFF_MS)) / 1000");
    // The burst re-checks for a still-sounding cue at fire time — a beat
    // that started since the burst was scheduled is never overlapped.
    expect(source).toContain("fireBurst");
    // The user's 2026-11-19 review amendment removed the test-sound
    // control entirely (77's original test-button requirement is moot).
    expect(source).not.toContain("Test notification sound");
    expect(source).not.toContain("testSound");
  });

  it("stops alerts — never ordinary cues — on mute, and restarts on unmute while a conversation still needs a human", async () => {
    const source = await readFile(
      path.join(repoRoot(), "src/app/dashboard/inbox/attention-sounds.tsx"),
      "utf8",
    );
    const toggle = between(source, "function toggleMuted", "return (");
    expect(toggle).toContain("stopAlertCycle()");
    expect(toggle).toContain("startAlertCycle()");
    // Only alert-typed sounds are stopped mid-flight; an ordinary cue
    // keeps 44's ring-out.
    expect(source).toContain("if (currentSoundRef.current?.isAlert) stopCurrentSound();");
    // The instant stop both paths rely on: disconnecting kills every
    // oscillator the sounding alert scheduled.
    expect(source).toContain("master.disconnect()");
  });

  it("cancels the cycle and kills in-flight sound when the desk view unmounts", async () => {
    const source = await readFile(
      path.join(repoRoot(), "src/app/dashboard/inbox/attention-sounds.tsx"),
      "utf8",
    );
    const cleanup = between(source, "return () => {", "const handler = gestureHandlerRef.current;");
    expect(cleanup).toContain("alertCycleRef.current?.stop()");
    expect(cleanup).toContain("stopAlertSound()");
  });

  it("keeps 44's guarded audio construction and burst coalescing", async () => {
    const source = await readFile(
      path.join(repoRoot(), "src/app/dashboard/inbox/attention-sounds.tsx"),
      "utf8",
    );
    // Playback and context construction can fail (headless browsers,
    // missing audio devices): every failure path is caught so polling
    // never breaks.
    expect(source).toMatch(/try \{[\s\S]*new AudioContext/);
    expect(source).toMatch(/catch/);
    // One burst of attention events still coalesces into a single cue.
    expect(source).toContain("burstTimerRef");
  });
});
