# 38: Compact the handoff state and make the transcript the dominant region

**Status:** ready-for-human

**Reference screenshots:**
- [Handoff state: intro line + notice + email note crowding the widget](../references/visitor-widget-handoff-crowded-before.png)
- [After declining email: transcript shrunk to a small scroll area](../references/visitor-widget-transcript-cramped-before.png)

**What to build:** Three changes to the visitor widget's vertical space budget (`src/app/widget/frame/page.tsx` + `frame.module.css`):

**1. Remove the intro line once topics exist.**
- [ ] "Pick a topic, or type your question." and its takeover variant "Pick a topic to send to staff, or type your question." no longer render when topic chips are visible — the chips are self-explanatory (user: "users know that it will be clickable").
- [ ] During handoff the "College staff will reply in this chat. Automated answers are paused." notice already conveys the state, so the removed takeover line loses no information. Chips clicked during handoff still send to staff (ticket 18 behavior — unchanged).
- [ ] The no-topics fallback "Ask us your question." may stay (it is then the only guidance) — implementer's judgment, keep it small.

**2. Auto-dismiss the email-declined note.**
- [ ] "No email saved: staff can reply only while this chat stays open on your device…" appears after declining, then removes itself after 10 seconds.
- [ ] The dismissal animates only under `prefers-reduced-motion: no-preference` (the ticket-15 pattern); removal itself must never trap attention or be announced (it is below the live region — fine).
- [ ] It does not reappear on every subsequent message — once per declined handoff is right (same spirit as the one-time email prompt).
- [ ] The "Thanks — if staff reply…" saved-confirmation may share the same 10s treatment — implementer's judgment; either is acceptable.

**3. Make the transcript the dominant region.**
- [ ] The message log flex-grows to fill the widget: topics strip, notices, email box, and composer keep their natural heights; the transcript absorbs all remaining space instead of being squeezed to a small scroll window (screenshot 2).
- [ ] When handoff notices and the email box appear, they take as little height as practical (compact paddings/one-line layouts where possible) so the transcript stays clearly the primary surface.
- [ ] The email-capture box may be compacted (tighter stacking, smaller footprint) as long as inputs stay ≥24px touch targets (issue 27) and the label/`autocomplete` work in issue 29 isn't regressed.
- [ ] Nothing overflows or clips at 360px, phone, and desktop widths, with a long transcript plus the full handoff state visible at once.

**Tests:** `tests/embed-smoke.test.ts` pins the takeover intro wording from ticket 18 — update those pins for the removed line, and add checks: declined note appears once and is gone after ~10s (fake timers), transcript is the flex-dominant region (layout assertion or measured heights in `scripts/topics-shots.mjs`'s successor), long-transcript + handoff + 360px visual pass.

## Context

The user's screenshots show the handoff state stacking three text blocks above the composer, leaving the transcript a small scrollable window — for a chat product the conversation must be the primary surface. This amends ticket 18's takeover wording contract (the intro-line swap was its answer to "don't promise instant bot answers during takeover"; the handoff notice alone now carries that meaning) and sits inside the ticket 13–15 visual/motion system. Tickets 35 (launcher toggle) and 36 (chip wrapping) touch the same lower region — coordinate if implemented together. Issue 25's announcements are unaffected: the handoff/claim notices remain, just without the intro line.

## Comments

2026-11-01: Filed from the user's request (intro line removal, 10-second auto-dismiss of the no-email note, transcript dominance) with two supplied screenshots. Board note: ticket 18's human pass should follow this ticket since it amends 18's pinned wording.

## Comments

2026-11-03: IMPLEMENTED (`ready-for-human`).

**Intro line**: both "Pick a topic…" variants removed — the strip renders the guidance only when no topics exist ("Ask us your question." stays there). Supersedes ticket 18's takeover wording; the handoff notice alone carries the state, and chips clicked during takeover still send to staff. `embed-smoke`'s ticket-18 block lost the old pin; a new ticket-38 block pins the fallback and the absence of any "Pick a topic" string.

**Email notes**: one 10-second stay (`EMAIL_NOTE_TTL_MS`), then a reduced-motion-gated exit fade (`sfcw-depart`, the ticket-15 token pattern — 0ms under reduce), then unmount 200ms later; shows once per decline, reset in both fresh-chat paths (409 recovery + Clear conversation) via a `resetEmailPrompt()` helper so the saved/declined confirmations never leak across conversations.

**Transcript dominance**: handoff notice, email box, and notes compacted (6px top margins, tighter paddings); composer form 12→8px vertical; clear row bottom 10→8px. The error live region stays mounted (announcements must have a persistent region) but is zero-height while empty — the original 20px reservation plus its UA margins were the worst-case transcript thieves. Measured headless (production build, scratch DB, `topics-shots.mjs`): transcript share of panel height 17% before → 26.3% with the full handoff chrome → **51.9%** after the note leaves (0.45 threshold asserted); new no-clip assertion keeps log, strip, and composer inside the panel with the full handoff state + long transcript at once, at desktop, phone, and 360px.

**Review** (two-axis `/code-review`): derived `showEmailNote` gate, `resetEmailPrompt()` helper, `.log`-specific flex pin (the old `flex: 1` pin also matched `.emailInput` — vacuous), exit animation added per the ticket's motion box, once-per-decline re-assertion after subsequent messages, and the persistent-zero-height status region replacing a conditional mount after the review flagged the SR announcement risk. Review also flagged two accepted deviations, kept deliberately: the conditional status/padding compaction exceeds the ticket's literal file-list wording but is what moved the measured share from 42.6% (failing the bar) to 51.9%; fake timers are approximated by source pins (no DOM test env) plus the real-time headless check.

**Verification**: `typecheck` clean; `embed-smoke` 9/9; full suite 183 passed with `restart-persistence`'s 3 tests environmentally skipped — the user's own dev server (PID 17024, port 3000, up since 11/1) holds Next 16's one-dev-per-repo lock; the test spawns its own `next dev` and passes when the user's server is stopped (documented machine quirk, not touched). Headless evidence: `references/shots-after/after-widget-topics-{email-declined,note-dismissed}.png` and the full topics-shots pass (chips, fades, pending-send, one/none topics, 360px/phone).
