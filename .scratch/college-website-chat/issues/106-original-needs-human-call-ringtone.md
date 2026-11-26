# 106: Replace the Needs-human buzzer with an original incoming-call ringtone

Status: needs-triage

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

This ticket changes only the audio character of the repeating **Needs human**
alert introduced by ticket 77. It preserves:

- the existing visual Needs-human treatment and bell;
- the persisted Notification sounds on/off control;
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

This ticket will supersede ticket 77's buzzer waveform and any timing or gain
constants that triage explicitly replaces. It must not reopen the attention
state, alert-cycle, mute, autoplay, coalescing, or ordinary-chime decisions.

## Owner decisions required at triage

1. **Sound source and ownership.** Choose between an original ringtone
   synthesized in the existing Web Audio path (recommended: no binary asset,
   provenance is the reviewed note/envelope constants) or an original audio
   file commissioned/generated specifically for this repository. If a file is
   chosen, identify its author/tool, source project, license, and retained
   proof that the repository may redistribute it.
2. **Musical character.** Approve a concrete original motif: notes, waveform or
   instrument character, tempo, envelope, and number of repetitions inside one
   alert. It should read as an incoming call without imitating a third-party
   melody. Decide how calm versus urgent it should feel in a college office.
3. **Volume.** Approve the alert gain after listening on ordinary laptop
   speakers and headphones. The present `0.5` master gain is evidence, not an
   automatic requirement; the result must be audible without being startling
   or clipping. The ordinary chime stays at its current gain.
4. **Loop and cadence.** Decide whether one alert keeps ticket 77's six-second
   maximum and whether alerts keep the 30-second start-to-start repeat. The
   alert must never overlap its successor and must continue to repeat while at
   least one conversation remains in Needs human.
5. **Accessibility and control.** Confirm that the existing visual signal is
   the complete non-audio equivalent, the alert remains optional and locally
   muted, and no vibration, animation, browser notification, or system-level
   audio is added.
6. **Certification.** Approve both deterministic automation (the exact original
   motif, gain, maximum duration, repeat cadence, cancellation, mute/unmute,
   autoplay fallback, and unchanged ordinary chime) and a named human listening
   pass on supported desktop browsers, laptop speakers, and headphones. Decide
   whether a temporary development-only audition harness is permitted; no Test
   notification sound control may return to the product without a separate
   owner decision.

## Acceptance criteria after those decisions are recorded

- The Needs-human alert uses only the owner-approved original composition and
  contains no copied or bundled Microsoft Teams or other third-party audio.
- Repository evidence records how the sound was created and why the project
  has the right to distribute it; an asset, if approved, carries the decided
  license/provenance record.
- The approved motif, gain, alert duration, and repeat cadence are pinned by
  deterministic tests. Alerts never overlap.
- One shared alert cycle repeats while any live conversation remains in Needs
  human and stops immediately when the state clears, sounds are muted, or the
  desk unmounts. Unmuting while a conversation is still waiting starts the
  cycle again under the approved cadence.
- Browser autoplay restrictions retain the existing first-interaction recovery
  and never produce a backlog of alerts. Playback or timer failure never breaks
  inbox refresh or interaction.
- The ordinary new-message/contact-attention chime, visual indicators, mute
  persistence, and attention-event deduplication remain behaviorally unchanged.
- The owner-approved browser/listening certification is recorded honestly,
  including devices, volume settings, and any browser where audio could not be
  exercised.
- GLOSSARY.md and tickets 44/77 receive only the minimum supersession wording
  necessary to describe the final sound; no unrelated dashboard behavior is
  changed.

## Constraints

- Do not copy or approximate a third-party melody note-for-note, use a recording
  from another application, or depend on a remote audio URL.
- Do not add a production audition button, change the mute UI, add push/system
  notifications, or change conversation state semantics.
- Do not alter the ordinary one-shot chime.
- Build exactly the triaged decisions; additional audio preferences require a
  separate ticket or amendment.

## Comments

2026-11-27: Filed from the owner's request that the Needs-human notification
sound like an incoming Teams call. The request is deliberately translated into
an original office-call design brief rather than permission to reproduce
Microsoft audio. Tickets 44 and 77 and the current Web Audio implementation
were inspected before the scope and triage frontier were written. No audio,
application code, test, dependency, or product behavior changed in this filing.
