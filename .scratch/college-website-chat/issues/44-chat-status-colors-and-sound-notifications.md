# 44: Add clear chat status colors and optional sound notifications

**Status:** ready-for-human

**What to build:** Make the staff conversation desk easier to scan by giving chat states consistent visual treatments and playing a restrained notification sound when a chat newly needs human attention, similar in purpose to Tawk.to.

- [ ] Define and apply a consistent visual treatment for at least: **Active**, **new activity/notification**, and **Needs human**. Use the same mapping in list entries, badges, counts, and the selected conversation header.
- [ ] **Needs human** is the strongest state and applies to escalated conversations waiting for staff. **Notification** marks new visitor activity that staff have not handled. **Active** identifies an ongoing chat without unread attention.
- [ ] Do not communicate state by color alone. Every state also has visible text and/or an icon with an accessible name; colors meet contrast requirements in their actual foreground/background combinations.
- [ ] When a conversation newly enters **Needs human**, or receives a new visitor message requiring attention, play one short notification sound for authorized staff viewing the dashboard.
- [ ] Polling, re-rendering, navigation, and opening a second view must not repeatedly play sound for the same attention event. Persist or derive a stable event identity so each event sounds at most once per staff browser session.
- [ ] Provide an obvious dashboard control to mute/unmute notification sounds. Default behavior must respect browser autoplay restrictions: if audio cannot play before user interaction, show a quiet prompt or enable it after the staff member's first interaction rather than throwing or looping.
- [ ] Persist the staff member's sound preference locally. Muting sound must not hide visual attention indicators.
- [ ] Do not include transcript text, visitor email, or other sensitive content in notification metadata. This ticket adds in-dashboard audio and visual feedback, not browser/system push notifications.
- [ ] Multiple attention events arriving together should produce one restrained cue rather than overlapping sounds. Sound playback failures must never break inbox polling or interaction.
- [ ] Respect accessibility and user preferences: provide a non-audio equivalent, do not rely on animation, and avoid continuous/repeating alarm sounds.
- [ ] Tests cover the status mapping, accessible non-color labels, one sound per new event, no sound on ordinary polling, mute persistence, burst coalescing, and graceful autoplay/playback failure.

## Context

Ticket 12 implemented the conversation desk, attention state, and in-dashboard badges, while explicitly excluding browser/system notifications. Ticket 13 established the dashboard visual language. This ticket deepens those existing signals with a consistent status palette and optional in-dashboard sound; it does not add push notifications or change conversation state semantics.

## Comments

2026-11-04: Filed from the user's request for status colors for active chats, notifications, and chats needing a human, plus sounds like Tawk.to. Sound is scoped as optional, deduplicated, in-dashboard feedback so routine polling cannot become noisy.

2026-11-05: Implemented (`Status:` → ready-for-human).

- **Tier mapping** lives in `src/domain/inbox.ts` (`deskStatus`): Needs human = awaiting_staff on the live desk (strongest, state-based, survives viewing); New message = standing attention; Active = live with nothing unread. History rows are the archive and carry no treatment — state text only. The class mapping is a single shared module (`inbox/status-classes.ts`) used by rows' dots, the selected header chip, and the count pills. Colors never work alone: every dot has `role="img"` + accessible name, the two attention-worthy tiers also show text badges, and both counts are text pills (gold "N new" for the attention tier, red "N waiting" for Incoming's needs-human count — each tier's count wears its own color). Contrast: dot colors are dedicated bright variants (`--danger-bright`, `--ok-bright`) because the rail is dark; text pairings reuse the house-AAA palette.
- **Sound**: Web Audio two-note chime (no asset), fired for attention episodes anchored at `attentionAt` — the store only stamps it when attention starts (glossary: "never duplicates while standing"), so the id `conversation:attentionAt` is a stable event identity: one cue per episode, at most once per staff browser (localStorage seen-set, 7-day prune). A burst coalesces into one cue (400ms window + no-overlap delay); playback and storage failures are swallowed and can never break polling. Autoplay-blocked audio holds events, unlocks on the staff member's first interaction, and plays one late cue for fresh events only (60s) instead of a backlog blast. Mute/unmute toggle lives under the desk tabs with `aria-pressed`, persists per browser, and never touches the server-rendered visual indicators. Events carry only `{conversationId, id}` — no transcript or email content.
- **Decisions worth review**: cueing is episode-anchored, not per-message (a second message during a standing episode does not re-cue — that is the spec's own "must not repeatedly play" clause plus the glossary's attention semantics). The sound covers the live desk only; new attention events cannot surface on History by construction (an inactive conversation's next visitor message starts a fresh conversation), so History stays silent backlog.
- **Verification**: `tests/desk-status.test.ts` (16 unit tests: mapping, identity, dedup/persistence/mute/prune, wiring pins) + full suite 220 passed; `scripts/desk-status-shots.mjs` headless certification, 17 checks green on a production build — including the full chime matrix counted through a fake AudioContext (silence on empty desk and polling, one cue per event/burst/mute-gate, reload and second-view dedup, exactly-one-view cueing, autoplay late cue) and DOM assertions for dots, badges, tier counts, and the header chip. Screenshots in `.scratch/college-website-chat/references/shots-desk-status/`.
- Review found and fixed: history rows misapplied the Active tier to closed conversations; the tab count conflated needs-human items into the attention pill; a view unmounting inside the burst window could swallow a cue (seen-marks now revert on unmount). Two-axis review also predicted a cross-view double-cue when seen-marks move to play time — the mark stays at schedule time and the unmount revert keeps both properties.
