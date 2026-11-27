import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ALERT_BREATH_MS,
  ALERT_GAIN,
  ALERT_NOTE_ATTACK_SECONDS,
  ALERT_NOTE_RING_SECONDS,
  ALERT_SOUNDED_SECONDS,
  CHIME_NOTES,
  CUE_GAIN,
  NOTE_RING_SECONDS,
  RING_NOTES,
  createAlertCycle,
  nextRingAt,
} from "../src/domain/attentionCues";
import { repoRoot } from "../src/paths";

/**
 * Ticket 106: the desk's louder, repeating needs-human alert is the
 * owner-chosen "Marimba greeting" (2026-11-27 triage) — a triangle-wave
 * C5/E5/G5 arpeggio whose three-note phrase repeats once, each note with a
 * 6 ms attack and a 0.38-second exponential ring-out, sounding ≈ 1.6
 * seconds per alert at the 0.5 master gain. The alert rings continuously
 * while a live desk conversation is in Needs human: the next play starts
 * exactly 0.5 seconds after the previous play's sounded end (start-to-start
 * ≈ 2.1 seconds nominal), never overlapping another sound, and stops —
 * current play and future repeats — the moment the state clears or sounds
 * are muted. Unmuting with a conversation still waiting restarts the loop
 * without waiting for another event. Ordinary new-message attention keeps
 * 44's one-cue behavior at the softer chime gain, unchanged. This
 * supersedes ticket 77's square-wave buzzer, its 6-second window, and its
 * 30-second repeat.
 */

/** A manual clock: handlers fire in time order as the test advances, so
 *  the continuous ring's rhythm is observed without real waiting. */
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
      // Each play "sounds" for half a second.
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

describe("the continuous needs-human ring (ticket 106)", () => {
  it("uses the louder 0.5 alert gain and keeps the ordinary cue at 0.16", () => {
    expect(ALERT_GAIN).toBe(0.5);
    expect(CUE_GAIN).toBe(0.16);
  });

  it("pins the owner-approved Marimba greeting motif", () => {
    // Triangle-wave C5, E5, and G5: the first three notes are the phrase,
    // the phrase repeats once at +0.60 seconds (owner triage, 2026-11-27).
    expect(RING_NOTES).toEqual([
      [0, 523.25],
      [0.15, 659.25],
      [0.3, 783.99],
      [0.9, 523.25],
      [1.05, 659.25],
      [1.2, 783.99],
    ]);
    const phrase = RING_NOTES.slice(0, 3);
    const repeat = RING_NOTES.slice(3);
    expect(
      repeat.map(([offset, frequency]) => [
        Math.round((offset - 0.9) * 100) / 100,
        frequency,
      ]),
    ).toEqual(phrase);
  });

  it("shapes each note with a 6 ms attack and a 0.38-second ring-out", () => {
    expect(ALERT_NOTE_ATTACK_SECONDS).toBe(0.006);
    expect(ALERT_NOTE_RING_SECONDS).toBe(0.38);
    // The motif's sounded length is the last note's onset plus its
    // ring-out: ≈ 1.6 seconds, the last note ending ≈ 1.58 s after start.
    const lastOnset = Math.max(...RING_NOTES.map(([offset]) => offset));
    expect(lastOnset + ALERT_NOTE_RING_SECONDS).toBeCloseTo(1.58, 10);
    expect(ALERT_SOUNDED_SECONDS).toBe(1.58);
  });

  it("keeps 44's ordinary two-note chime unchanged", () => {
    expect(CHIME_NOTES).toEqual([
      [0, 880],
      [0.16, 1174.66],
    ]);
    expect(NOTE_RING_SECONDS).toBe(0.36);
    expect(CUE_GAIN).toBe(0.16);
  });

  it("rings continuously: the next play starts one breath after the sounded end", () => {
    // Owner override of ticket 77's 30-second repeat (2026-11-27 triage):
    // phrase, then a 0.5-second quiet breath, then the phrase again.
    expect(ALERT_BREATH_MS).toBe(500);
    // Nominal start-to-start: 1.58 s sounded + 0.5 s breath ≈ 2.1 seconds.
    expect(ALERT_SOUNDED_SECONDS * 1000 + ALERT_BREATH_MS).toBe(2080);
    const { cycle, clock, playedAt } = alertHarness();
    cycle.start();
    expect(playedAt).toEqual([0]);
    // The harness's half-second sound plus the 0.5-second breath.
    clock.advance(1_000);
    expect(playedAt).toEqual([0, 1_000]);
    clock.advance(1_000);
    expect(playedAt).toEqual([0, 1_000, 2_000]);
  });

  it("schedules each next play with nextRingAt: sounded end plus the breath", () => {
    expect(nextRingAt(0)).toBe(500);
    expect(nextRingAt(1_580)).toBe(2_080);
    expect(nextRingAt(10_000)).toBe(10_500);
  });

  it("never starts a play while another cue or alert is still sounding", () => {
    const { cycle, clock, playedAt, setQuietAt } = alertHarness();
    setQuietAt(4_000); // an ordinary cue is in flight until t=4000
    cycle.start();
    expect(playedAt).toEqual([]);
    expect(clock.pending()).toBe(1);
    clock.advance(3_999);
    expect(playedAt).toEqual([]);
    clock.advance(1);
    expect(playedAt).toEqual([4_000]);
    // The rhythm runs from the actual start of the first play.
    clock.advance(1_000);
    expect(playedAt).toEqual([4_000, 5_000]);
  });

  it("ends silently when the state clears between plays and stops re-arming", () => {
    const { cycle, clock, playedAt, setSoundable } = alertHarness();
    cycle.start();
    expect(playedAt).toEqual([0]);
    setSoundable(false); // the last waiting conversation left Needs human
    clock.advance(1_000);
    expect(playedAt).toEqual([0]);
    expect(clock.pending()).toBe(0);
    // With the state still cleared, restarting changes nothing...
    cycle.start();
    expect(clock.pending()).toBe(0);
    // ...but the state returning (a new escalation) sounds again, right now.
    setSoundable(true);
    cycle.start();
    expect(playedAt).toEqual([0, 1_000]);
  });

  it("cancels the next play when stopped, and stopping twice is harmless", () => {
    const { cycle, clock, playedAt } = alertHarness();
    cycle.start();
    clock.advance(600);
    cycle.stop();
    expect(clock.pending()).toBe(0);
    cycle.stop();
    clock.advance(60_000);
    expect(playedAt).toEqual([0]);
  });

  it("runs one shared cycle however many times it is started", () => {
    // Multiple waiting conversations share one alert cycle: the component
    // holds a single cycle, and a second start must never stack plays.
    const { cycle, clock, playedAt } = alertHarness();
    cycle.start();
    cycle.start();
    cycle.start();
    clock.advance(1_000);
    expect(playedAt).toEqual([0, 1_000]);
    expect(clock.pending()).toBe(1);
  });

  it("keeps the rhythm when playback fails, so audio trouble cannot end the ring", () => {
    const { cycle, clock, playedAt } = alertHarness({ failPlay: true });
    cycle.start();
    clock.advance(500);
    clock.advance(500);
    expect(playedAt).toEqual([]);
    expect(clock.pending()).toBe(1);
  });

  it("adopts an out-of-cycle play as a beat and ignores adoption while one is pending", () => {
    // The coalesced burst cue doubles as the first beat: the next repeat
    // begins one breath after its sounded end.
    const adopted = alertHarness();
    adopted.cycle.adopt(adopted.clock.now() + 500);
    expect(adopted.playedAt).toEqual([]);
    adopted.clock.advance(1_000);
    expect(adopted.playedAt).toEqual([1_000]);
    // Adopting again mid-cycle must not reset the rhythm.
    adopted.clock.advance(500);
    adopted.cycle.adopt(adopted.clock.now() + 500);
    adopted.clock.advance(500);
    expect(adopted.playedAt).toEqual([1_000, 2_000]);
  });
});

describe("the continuous needs-human ring wiring (ticket 106)", () => {
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

  it("sounds the alert as the triangle-wave Marimba greeting and keeps ordinary cues as the soft chime", async () => {
    const source = await readFile(
      path.join(repoRoot(), "src/app/dashboard/inbox/attention-sounds.tsx"),
      "utf8",
    );
    // The cycle's own plays sound the ringtone.
    expect(source).toContain("chimeEndsAtRef.current = playRingtone(context)");
    // A burst cue follows its batch: a batch containing a Needs-human
    // escalation is the ringtone alert, ordinary attention stays at 44's
    // softer chime even mid-ring.
    expect(source).toContain("? playRingtone(context)");
    expect(source).toContain(": playChime(context)");
    // The greeting is triangle-wave notes from the domain motif — no
    // square-wave buzzer character remains.
    expect(source).toContain('osc.type = "triangle"');
    expect(source).not.toContain('"square"');
    expect(source).toContain("RING_NOTES");
    expect(source).not.toContain("BUZZ_");
    expect(source).not.toContain("playBuzzer");
    // The struck-note envelope: 6 ms attack and 0.38-second exponential
    // ring-out per note, from the domain constants.
    expect(source).toContain("onset + ALERT_NOTE_ATTACK_SECONDS");
    expect(source).toContain("onset + ALERT_NOTE_RING_SECONDS");
    // The alert keeps the louder master gain.
    expect(source).toContain("beginSound(context, ALERT_GAIN, true)");
    // The ordinary cue is still 44's sine two-note chime at the softer
    // gain with its own ring-out.
    expect(source).toContain('osc.type = "sine"');
    expect(source).toContain("beginSound(context, CUE_GAIN, false)");
    expect(source).toContain("NOTE_RING_SECONDS");
    // The burst re-checks for a still-sounding cue at fire time — a beat
    // that started since the burst was scheduled is never overlapped.
    expect(source).toContain("fireBurst");
    // The user's 2026-11-19 review amendment removed the test-sound
    // control entirely (77's original test-button requirement is moot,
    // and ticket 106 keeps it removed).
    expect(source).not.toContain("Test notification sound");
    expect(source).not.toContain("testSound");
  });

  it("gates the loop on the unmuted needs-human state — muted, the ring never sounds", async () => {
    const source = await readFile(
      path.join(repoRoot(), "src/app/dashboard/inbox/attention-sounds.tsx"),
      "utf8",
    );
    // Every beat re-checks the gate before sounding, so a mute or a
    // cleared needs-human state ends the loop without a stray play.
    expect(source).toContain(
      "shouldSound: () => !mutedRef.current && needsHumanRef.current",
    );
  });

  it("stops the loop when the desk state clears — a claim or any other leave of Needs human — and restarts it when the state returns", async () => {
    const source = await readFile(
      path.join(repoRoot(), "src/app/dashboard/inbox/attention-sounds.tsx"),
      "utf8",
    );
    // The loop follows the desk's state prop, not events: a claim and any
    // other leave of the live awaiting_staff list both empty the prop, and
    // this effect cancels the current play and the next beat for both.
    const effect = between(source, "needsHumanRef.current = needsHuman;", "armFirstGesture(context);");
    expect(effect).toContain("if (!needsHuman || mutedRef.current) {");
    expect(effect).toContain("stopAlertCycle()");
    // When the state is present again (or audio unlocks with it present),
    // the loop starts from that same effect/unlock path.
    expect(effect).toContain("startAlertCycle()");
  });

  it("starts the loop from the autoplay unlock when Needs human is already present, with held events following the freshness rules", async () => {
    const source = await readFile(
      path.join(repoRoot(), "src/app/dashboard/inbox/attention-sounds.tsx"),
      "utf8",
    );
    const unlock = between(source, "const onGesture = () => {", ".catch(() => {");
    // The unlock path starts the ring when the state is present and
    // unmuted — stale or not: that play is also the late cue for anything
    // held while audio was blocked.
    expect(unlock).toContain("if (needsHumanRef.current && !mutedRef.current) {");
    expect(unlock).toContain("startAlertCycle()");
    // Without the state, held events follow 44's freshness rules — one
    // late cue for fresh events, silent marking for a stale backlog.
    expect(unlock).toContain("CUE_FRESH_MS");
    expect(unlock).toContain("scheduleChime(context, held.map((event) => event.id), false)");
    expect(unlock).toContain("tracker.markSeen(held.map((event) => event.id))");
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
