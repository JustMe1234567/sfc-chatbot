# 77: Repeat a louder alert while a conversation needs human attention

Status: ready-for-human

## What to build

Strengthen the conversation desk's notification sound so staff continue to hear an alert while at least one conversation remains in **Needs human**.

- Play a clearly louder version of the existing notification cue when a conversation enters **Needs human**. Increase the Web Audio master gain from `0.16` to `0.5`.
- Each alert may sound for up to 6 seconds. Repeat the alert every 30 seconds, measured from the start of one alert to the start of the next.
- Keep repeating while one or more live desk conversations remain in **Needs human** (`awaiting_staff`). Multiple waiting conversations share one alert cycle and must not create overlapping sounds.
- Stop the current alert and cancel future repeats immediately when no live conversation remains in **Needs human**, including when the last waiting conversation is taken over or otherwise leaves that state.
- Muting notification sounds must stop the current alert and cancel repeats immediately. Unmuting while a conversation still needs a human starts a new alert cycle without waiting for another conversation event.
- Preserve the existing visual indicators, persisted mute preference, autoplay handling, and failure isolation. Audio or timer failures must never break inbox polling or interaction.
- The **Test notification sound** control plays one louder alert for up to 6 seconds but does not start a repeating cycle.
- Update the control title and domain documentation so they no longer describe the sound as a one-time short cue.

This ticket intentionally supersedes ticket 44's requirements that each attention event sound at most once and that alarm sounds not repeat. It changes only the audio behavior for the **Needs human** state; ordinary new-message attention keeps its existing one-cue behavior.

## Acceptance criteria

- With sounds enabled and one or more conversations in **Needs human**, an alert starts and another begins every 30 seconds while that state remains present.
- Each alert ends no later than 6 seconds after it starts, and alerts never overlap.
- The alert uses a master gain of `0.5` instead of `0.16`.
- Taking over the last waiting conversation or muting sounds stops active playback and prevents the next scheduled repeat.
- Unmuting while a conversation still needs a human starts the alert cycle again.
- New-message attention that is not **Needs human** still sounds only once per attention episode.
- Tests cover the 30-second interval, 6-second maximum duration, increased gain, coalescing of multiple waiting conversations, cancellation, mute/unmute behavior, and the non-repeating test button.

## Comments

2026-11-19: Filed from the user's request for a louder, repeating notification whenever a conversation needs a human.

2026-11-19: Implemented (`Status:` → ready-for-human).

- **Domain timing** lives in `src/domain/attentionCues.ts`: `ALERT_GAIN = 0.5` / `CUE_GAIN = 0.16`, `ALERT_REPEAT_MS = 30_000`, `ALERT_MAX_MS = 6_000`, `nextAlertAt(startedAt, soundedUntil)` (start-to-start 30s, sounded end capped at 6s so no alert can delay or overlap its successor), the chime notes moved here so the sounded length is testable, and `createAlertCycle` — the beat chain: play as soon as the air is quiet, re-check `shouldSound()` before every beat, keep the schedule even when playback fails, `adopt()` an out-of-cycle alert (the coalesced burst cue) as the current beat, `stop()` cancels the next beat. Timer plumbing is injectable; the tests drive a manual clock.
- **Component** (`src/app/dashboard/inbox/attention-sounds.tsx`): the cycle is driven by a new `needsHuman` prop, not by attention events, so every waiting conversation shares one cycle and a viewed-but-unclaimed conversation keeps it running. Beats play the chime at 0.5; the burst cue's volume follows the desk state (`needsHumanRef ? ALERT_GAIN : CUE_GAIN`) and adopts itself as the first beat. Muting and a cleared needs-human state stop the current alert instantly (disconnect the cue's master gain) and cancel the next repeat; unmuting with a conversation still waiting restarts the cycle immediately (arming the gesture unlock first if audio is still blocked). Autoplay handling keeps 44's hold/unlock path — the unlock's late cue becomes the cycle's louder alert when the state is present. Ordinary attention and contact requests keep one 0.16 cue per episode. The test button plays one 0.5 alert, never starts a cycle. Unmount cancels the beat and kills in-flight sound. Control title no longer says "one short cue".
- **Desk wiring** (`conversation-desk.tsx`): `needsHuman = desk !== null && desk.incoming.length > 0` — Incoming is exactly the live `awaiting_staff` list; History (no desk scan) never sounds.
- **Docs**: GLOSSARY.md's Notification sound entry rewritten (no longer a one-time short cue); ticket 44's file carries a supersession note for the two boxes this ticket replaces.
- **Verification**: `npx tsc --noEmit` clean; new `tests/alert-cycle.test.ts` (15 tests: gain values, 30s start-to-start interval, ≤6s duration, non-overlap quiet-wait, beat re-check end, stop/double-stop, single shared cycle, failed-playback rhythm keep, adopt semantics, wiring pins incl. mute/unmute and test-button exclusion) + full suite 502 passed / 0 failed (5 env-skipped restart-persistence, unchanged).
- **Deferred**: my GLOSSARY.md edit is in the working tree but NOT in this commit — the file also holds the concurrent Supabase session's uncommitted Owner/Embed-allowlist entries, and a pathspec commit would swallow their hunks. Land it with ticket 76's doc commit or in housekeeping. `scripts/desk-status-shots.mjs` (ticket 44's browser cert) predates this ticket and is untouched; its one-cue assertions remain true for ordinary attention.
