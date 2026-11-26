# 106: Replace the Needs-human buzzer with an original incoming-call ringtone

Status: ready-for-agent

## What this ticket asks for

Replace the current harsh square-wave **Needs human** buzzer with an original,
melodic incoming-call alert suited to an office. The design brief is the
recognizable, repeating character of a modern calling application such as
Microsoft Teams; it is not permission to copy that product's recording,
composition, branding, or waveform.

The new alert must remain repository-owned and independently created. Do not
download, extract, trace, sample, transcribe, or bundle Microsoft Teams audio
or another third party's ringtone. Product copy must not call the result a
Teams sound.

This ticket changes the audio character of the repeating **Needs human** alert
introduced by ticket 77 and — per the owner's 2026-11-27 triage decision — its
repeat cadence. It preserves:

- the existing visual Needs-human treatment and bell;
- the persisted Notification sounds on/off control (structure, persistence,
  and current tooltip copy unchanged);
- guarded Web Audio construction and the first-gesture/autoplay fallback;
- one shared alert cycle however many conversations are waiting;
- immediate cancellation when the last waiting conversation is claimed or
  otherwise clears, when sounds are muted, or when the desk unmounts;
- failure isolation: audio trouble never breaks polling or dashboard use; and
- ticket 44's softer, one-shot new-message chime unchanged.

## Current implementation and supersession boundary

Ticket 44 introduced the ordinary two-note Web Audio chime, stable event
identity, burst coalescing, mute persistence, autoplay recovery, and the
non-audio status treatment. Ticket 77 superseded only the Needs-human audio:
`src/domain/attentionCues.ts` defines a 350 Hz square wave, three one-second
buzzes separated by one-second gaps across a six-second alert window, at gain
`0.5`, with the whole alert repeating every 30 seconds. The component in
`src/app/dashboard/inbox/attention-sounds.tsx` synthesizes it with oscillators;
there is no audio asset today.

This ticket supersedes ticket 77's buzzer waveform and — by the owner's
explicit recorded decision — ticket 77's 30-second start-to-start repeat and
6-second alert window, replaced by the continuous ring defined in the
acceptance criteria. It must not reopen the attention state, mute, autoplay,
coalescing, or ordinary-chime decisions.

## Owner decisions (2026-11-27 triage)

All six decision areas were resolved with the owner in a sound-design triage
session on 2026-11-27. The decision record with rationale is in Comments; the
acceptance criteria below are the pinned contract, written so an agent can
implement it without guessing.

## Acceptance criteria

- The Needs-human alert is synthesized at playback time with Web Audio
  oscillators. No audio asset file, no remote audio URL, and no third-party
  audio of any kind is added. The composition exists only as named constants in
  the shared domain alert module; the repository history plus this ticket's
  triage record are the provenance evidence, and no asset license file is
  needed on the synthesis path.
- The alert's composition is exactly the owner-approved "Marimba greeting"
  (audition candidate B): triangle-wave notes at 523.25 Hz (C5), 659.25 Hz
  (E5), and 783.99 Hz (G5), with onsets 0 / 0.15 / 0.30 / 0.90 / 1.05 / 1.20
  seconds from alert start (the first three notes are the phrase; the phrase
  repeats at +0.60 seconds), each note ramping from silence to full over 6 ms
  and exponentially decaying to silence over 0.38 seconds from onset. Total
  sounded length is ≈ 1.6 seconds (the last note ends ≈ 1.58 seconds after
  alert start).
- The alert's master gain stays `ALERT_GAIN = 0.5`. The ordinary new-message /
  contact-attention chime keeps `CUE_GAIN = 0.16`, its existing notes, and its
  ring-out behavior, unchanged.
- Continuous ring (supersedes ticket 77's 30-second repeat and 6-second
  window): while at least one live desk conversation is in Needs human and
  sounds are unmuted, the alert replays with the next play starting exactly
  0.5 seconds after the previous play's sounded end (start-to-start ≈ 2.1
  seconds nominal) — a phrase-then-breath loop that reads as a phone ringing.
  A play never starts while any cue or alert is still sounding.
- The ring stops immediately when the last waiting conversation is taken over
  or otherwise leaves the live `awaiting_staff` state. Muting stops the
  current play instantly, cancels the loop, and — while muted — no alert
  sound plays at all. Unmuting while a conversation still waits restarts the
  loop immediately. Desk unmount cancels the loop and kills in-flight alert
  playback; an ordinary cue caught mid-flight keeps 44's ring-out.
- One shared loop sounds however many conversations are waiting; the waiting
  count never stacks, overlaps, or multiplies alerts.
- Playback or timer failure never breaks inbox polling or interaction; a
  failed play still schedules the next beat, so audio trouble cannot end the
  loop.
- Autoplay handling is unchanged: suspended audio waits for the staff
  member's first gesture, the unlock path starts the loop when the Needs
  -human state is present, and held events follow the existing freshness
  rules — never a backlog blast.
- The mute toggle, its persistence, its current tooltip copy, and the
  server-rendered visual indicators are unchanged. No vibration, animation,
  browser or system notification, or system-level audio is added. Product
  copy never names Microsoft Teams.
- Deterministic tests replace the buzzer pins with the pins above: the motif
  constants (frequencies, waveform, onsets, attack, ring-out, sounded
  length), both gains, the 0.5-second breath cadence and non-overlap rule,
  stop/restart paths (claim, other clear, mute, unmute, unmount), muted
  silence, autoplay fallback, shared-cycle semantics, and failed-playback
  rhythm — and they prove the ordinary chime unchanged. The `BUZZ_*`
  constants and every buzzer pin, including the buzzer source-string wiring
  pins, are removed or replaced.
- After implementation, a named human listening pass on the shipped alert is
  recorded in this ticket: the listener, devices (ordinary laptop speakers
  and headphones), browsers, volume settings, and any browser where audio
  could not be exercised.
- GLOSSARY.md's notification-sound entry and tickets 44/77 receive only the
  minimum supersession wording necessary: 44/77 gain a comment line noting
  that ticket 106 supersedes the Needs-human audio character and cadence, and
  the glossary entry describes the continuous marimba ring. No unrelated
  dashboard behavior is changed.

### Out of scope

- An audio-asset pipeline: no commissioning, recording, downloading, or
  bundling of sound files; no asset loader.
- A product audition control: the Test notification sound button stays
  removed (ticket 77's review amendment) and returns only by separate owner
  decision.
- Changes to the mute UI's structure, persistence, or copy; a separate
  alert-volume control; any new audio preference.
- Browser/system push notifications, vibration, or system-level audio.
- Conversation-state semantics, attention-event identity, burst coalescing,
  polling behavior, or the ordinary one-shot chime.

## Constraints

- Do not copy or approximate a third-party melody note-for-note, use a
  recording from another application, or depend on a remote audio URL.
- Do not add a production audition button, change the mute UI, add
  push/system notifications, or change conversation state semantics.
- Do not alter the ordinary one-shot chime.
- Build exactly the triage decisions recorded in Comments; additional audio
  preferences or cadence changes require a separate ticket or amendment.

## Comments

2026-11-27: Filed from the owner's request that the Needs-human notification
sound like an incoming Teams call. The request is deliberately translated into
an original office-call design brief rather than permission to reproduce
Microsoft audio. Tickets 44 and 77 and the current Web Audio implementation
were inspected before the scope and triage frontier were written. No audio,
application code, test, dependency, or product behavior changed in this filing.

> *This was generated by AI during triage.*

2026-11-27: TRIAGE — sound-design decision session with the owner. All six
decision areas resolved; `Status:` → ready-for-agent. Context inspected
before deciding: tickets 44 and 77, this ticket's filing,
`src/domain/attentionCues.ts`, `src/app/dashboard/inbox/attention-sounds.tsx`,
and the alert tests (`tests/alert-cycle.test.ts` pins). Redundancy check: the
request replaces ticket 77's buzzer by design, so it is not an
already-implemented duplicate; no `.out-of-scope/` record resembles it.

1. **Sound source — Web Audio synthesis.** The repo carries no audio assets
   (`public/` has none) and no asset-loading path; the only Web Audio user is
   the attention-sounds component. An asset would need a retained
   author/tool/license/redistribution record and a new pipeline, while
   synthesis provenance is the reviewed constants in git, directly pinnable by
   deterministic tests. Owner approved synthesis.
2. **Motif — "Marimba greeting" (audition candidate B), chosen by the
   owner's ear.** Triage designed three clearly original candidates (A "Desk
   phone" bell pair, B marimba arpeggio, C "Two-tone query" lilt) from
   generic musical idioms — nothing transcribed, sampled, downloaded, or
   note-for-note approximated from Microsoft Teams or any third party — and,
   under an owner-approved temporary audition harness, the owner listened to
   all three plus the current buzzer and chose B. Pinned exactly as the
   harness played it: triangle-wave C5 523.25 Hz / E5 659.25 Hz / G5 783.99
   Hz, onsets 0 / 0.15 / 0.30 s, the phrase repeated at +0.60 s, 6 ms attack,
   0.38 s exponential ring-out per note (sounded ≈ 1.6 s per alert). The
   harness was a throwaway page outside the repository, never committed and
   never part of the product; it was deleted when the session ended.
3. **Volume — keep `ALERT_GAIN = 0.5`.** Parity with ticket 77's loudness
   intent ("heard across a room"); the triangle timbre removes the square
   wave's harshness at the same peak, and no clipping is possible at this
   gain with this composition. The ordinary chime stays at 0.16.
4. **Cadence — continuous ring until answered (owner override).** The owner
   chose that the sound "continuously play… until a user takes over that
   conversation," superseding ticket 77's 30-second repeat and 6-second
   window — the explicit exception to this filing's do-not-reopen boundary,
   exercised by the owner and recorded here. Pinned as a phrase-then-breath
   loop: the next play starts 0.5 seconds after the previous play's sounded
   end (≈ 2.1 s start-to-start), looping while at least one live conversation
   is in Needs human. Stop conditions (owner-confirmed): the last waiting
   conversation is taken over or otherwise leaves the state (a conversation
   that no longer exists cannot be taken over), sounds are muted, or the desk
   unmounts; unmuting while still waiting restarts immediately. Alarm-fatigue
   tradeoff noted for the record: the alert is no longer bounded per
   occurrence, so the persisted mute toggle is the standing escape hatch, and
   the one-shared-loop rule prevents stacking.
5. **Accessibility and control — confirmed as-is, one rule emphasized.** The
   server-rendered visual indicators remain the complete non-audio
   equivalent; the alert stays optional and locally muted; no vibration,
   animation, browser/system notification, or system-level audio is added.
   The owner's emphasized rule, recorded verbatim in intent: when muted, the
   ring never sounds. The toggle's structure, persistence, and existing
   tooltip copy stay unchanged (owner chose to keep the current copy rather
   than update it for the continuous cadence).
6. **Certification — both axes approved.** Deterministic automation replaces
   the BUZZ_* pins with pins for the exact motif, both gains, the 0.5-second
   breath cadence, non-overlap, every stop/restart path, muted silence,
   autoplay fallback, and the unchanged ordinary chime. Plus a named human
   listening pass on the shipped implementation (ordinary laptop speakers and
   headphones), recorded honestly in this ticket with devices, volume
   settings, and any browser where audio could not be exercised. No product
   audition control returns.
