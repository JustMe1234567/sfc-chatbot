# 77: Repeat a louder alert while a conversation needs human attention

Status: done

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

2026-11-21: OWNER ACCEPTED / STATUS RECONCILIATION. The implemented and
reviewed result recorded below is accepted. The stale `ready-for-human` status
is closed as `done`; no implementation change was made in this reconciliation.

2026-11-19: Filed from the user's request for a louder, repeating notification whenever a conversation needs a human.

2026-11-19: Implemented (`Status:` → ready-for-human).

- **Domain timing** lives in `src/domain/attentionCues.ts`: `ALERT_GAIN = 0.5` / `CUE_GAIN = 0.16`, `ALERT_REPEAT_MS = 30_000`, `ALERT_MAX_MS = 6_000`, `nextAlertAt(startedAt, soundedUntil)` (start-to-start 30s, sounded end capped at 6s so no alert can delay or overlap its successor), the chime notes moved here so the sounded length is testable, and `createAlertCycle` — the beat chain: play as soon as the air is quiet, re-check `shouldSound()` before every beat, keep the schedule even when playback fails, `adopt()` an out-of-cycle alert (the coalesced burst cue) as the current beat, `stop()` cancels the next beat. Timer plumbing is injectable; the tests drive a manual clock.
- **Component** (`src/app/dashboard/inbox/attention-sounds.tsx`): the cycle is driven by a new `needsHumanIds` prop — the live desk's awaiting_staff conversation ids — so every waiting conversation shares one cycle and a viewed-but-unclaimed conversation keeps it running. A burst cue whose batch contains a Needs-human escalation plays at 0.5 and adopts itself as the cycle's first beat; ordinary attention stays at 0.16 even mid-alarm. The burst re-checks for a still-sounding cue at fire time (a beat scheduled since it queued is never overlapped), and `queuedRef` clears only at the real fire so an unmount mid-recheck still un-marks. Muting and a cleared needs-human state stop the current alert instantly (disconnect the cue's master gain) and cancel the next repeat — only alert-typed sounds are stopped mid-flight, ordinary cues keep 44's ring-out; muting also cancels a burst yet to fire. Unmuting with a conversation still waiting restarts the cycle immediately (arming the gesture unlock first if audio is still blocked). Autoplay handling keeps 44's hold/unlock path — the unlock's late cue becomes the cycle's louder alert when the state is present. Ordinary attention and contact requests keep one 0.16 cue per episode. The test button plays one 0.5 alert, never starts a cycle. Unmount cancels the beat and kills in-flight alerts. Control title no longer says "one short cue".
- **Desk wiring** (`conversation-desk.tsx`): `needsHumanIds = desk ? desk.incoming.map((item) => item.id) : []` — Incoming is exactly the live `awaiting_staff` list; History (no desk scan) never sounds.
- **Docs**: GLOSSARY.md's Notification sound entry rewritten (no longer a one-time short cue); ticket 44's file carries a supersession note for the two boxes this ticket replaces.
- **Verification**: `npx tsc --noEmit` clean; new `tests/alert-cycle.test.ts` (15 tests: gain values, 30s start-to-start interval, ≤6s duration, non-overlap quiet-wait, beat re-check end, stop/double-stop, single shared cycle, failed-playback rhythm keep, adopt semantics, wiring pins incl. mute/unmute and test-button exclusion) + full suite 502 passed / 0 failed (5 env-skipped restart-persistence, unchanged).
- **Two-axis code review** (same day) found and fixed: burst cues played 0.5 whenever any conversation waited — volume now follows the batch (an escalation in the batch is the alert; ordinary attention keeps 0.16 mid-alarm, per "changes only the audio behavior for the Needs human state"); the burst's quiet-wait was computed at schedule time and could overlap a beat starting meanwhile — now re-checked at fire time; muting/state-clear killed ordinary cues mid-ring — now only alert-typed sounds are ever stopped mid-flight; dead `startedAt` in the burst callback deleted; muting cancels a pending burst. Accepted as-is: mute/unmute and the test button are covered by source wiring pins (the repo's seam for this component — no React renderer in the test stack) on top of the behavioral domain-cycle tests; a second open dashboard view runs its own cycle — 44's seen-set dedup cannot govern a state-driven repeating cycle, and cross-view cycle election is beyond this ticket's scope.

2026-11-19: **Review amendment — the "Test notification sound" control is removed** at the user's request (screenshot of the button, "remove this"). This supersedes the What-to-build bullet and the "non-repeating test button" test-coverage item for this ticket: the control and its handler are deleted, the desk keeps only the mute toggle, and the wiring tests now pin the control's absence. Everything else in this ticket stands.

2026-11-19: **Review amendment — the alert is a buzzer** at the user's request ("i want it that the sound notifications buzzes on and off for about 6 seconds, so 1 sec sound, then off, then sound again. just like a buzzer sound"). The needs-human alert is no longer the two-note chime at 0.5: it is a square-wave buzzer at 0.5 — one-second buzzes separated by one-second silences, three buzzes spanning the 6-second window — and the cycle still repeats the whole alert every 30 seconds. This refines the "clearly louder version of the existing notification cue" wording: the alert's character is buzzer-like, ordinary new-message attention keeps 44's chime. Domain constants `BUZZ_ON_MS/BUZZ_OFF_MS/BUZZ_COUNT/BUZZ_FREQUENCY_HZ`; `playBuzzer` in the component; the earlier "Test notification sound" removal stands.
- **Deferred**: my GLOSSARY.md edit is in the working tree but NOT in this commit — the file also holds the concurrent Supabase session's uncommitted Owner/Embed-allowlist entries, and a pathspec commit would swallow their hunks. Land it with ticket 76's doc commit or in housekeeping. `scripts/desk-status-shots.mjs` (ticket 44's browser cert) predates this ticket and is untouched; its one-cue assertions remain true for ordinary attention.
