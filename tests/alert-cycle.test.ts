import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ALERT_GAIN,
  ALERT_MAX_MS,
  ALERT_REPEAT_MS,
  CHIME_NOTES,
  CUE_GAIN,
  NOTE_RING_SECONDS,
  createAlertCycle,
  nextAlertAt,
} from "../src/domain/attentionCues";
import { repoRoot } from "../src/paths";

/**
 * Ticket 77: the desk's louder, repeating needs-human alert. The alert
 * sounds at a 0.5 master gain (up from 44's 0.16), starts when a live desk
 * conversation enters Needs human, repeats every 30 seconds from the start
 * of one alert to the start of the next while the state remains, ends no
 * later than 6 seconds after it starts, never overlaps another sound, and
 * stops — current alert and future repeats — the moment the state clears
 * or sounds are muted. Unmuting with a conversation still waiting starts a
 * new cycle without waiting for another event. Ordinary new-message
 * attention keeps 44's one-cue behavior, and the test button plays one
 * louder alert without starting a cycle.
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
    // The two-note chime is the alert: its last note's offset plus the
    // ring-out is the whole sounded length, far inside the maximum.
    const soundedSeconds = Math.max(
      ...CHIME_NOTES.map(([offset]) => offset + NOTE_RING_SECONDS),
    );
    expect(soundedSeconds).toBeLessThanOrEqual(ALERT_MAX_MS / 1000);
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
    // One boolean for the whole desk — Incoming is exactly the live
    // awaiting_staff list — so two waiting conversations cannot create two
    // cycles, and a viewed-but-unclaimed conversation keeps it running.
    expect(desk).toContain("const needsHuman = desk !== null && desk.incoming.length > 0;");
    expect(desk).toContain(
      "<AttentionSounds events={attentionEvents} needsHuman={needsHuman} />",
    );
  });

  it("sounds beats at the alert gain, burst cues by desk state, and keeps the test button out of the cycle", async () => {
    const source = await readFile(
      path.join(repoRoot(), "src/app/dashboard/inbox/attention-sounds.tsx"),
      "utf8",
    );
    // The cycle's own beats play the louder alert.
    expect(source).toContain("playChime(context, ALERT_GAIN)");
    // A burst cue's volume follows the desk's state: while a conversation
    // waits, the coalesced cue is the louder alert.
    expect(source).toContain("needsHumanRef.current ? ALERT_GAIN : CUE_GAIN");
    // The test button plays one louder alert — no cycle start, no adoption.
    const testFn = between(source, "function testSound", "return (");
    expect(testFn).toContain("ALERT_GAIN");
    expect(testFn).not.toContain("startAlertCycle");
    expect(testFn).not.toContain("adopt(");
  });

  it("stops on mute and restarts on unmute while a conversation still needs a human", async () => {
    const source = await readFile(
      path.join(repoRoot(), "src/app/dashboard/inbox/attention-sounds.tsx"),
      "utf8",
    );
    const toggle = between(source, "function toggleMuted", "function testSound");
    expect(toggle).toContain("stopAlertCycle()");
    expect(toggle).toContain("startAlertCycle()");
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
    expect(cleanup).toContain("stopCurrentSound()");
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
