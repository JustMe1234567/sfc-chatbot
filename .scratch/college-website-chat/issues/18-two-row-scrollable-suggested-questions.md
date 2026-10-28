# 18: Put suggested questions above the visitor message box

**Status:** ready-for-human

**What to build:** In the visitor chat widget, show the published question/topic buttons as a compact, two-row strip immediately above the message composer. Visitors can scroll the strip horizontally and click a question to send it. Keep the transcript as the main scrolling area.

**Blocked by:** 05: Publish answer rules and topic buttons (resolved). Coordinate final widget styling with tickets 15 and 16 if they are implemented at the same time.

**Reference screenshot:** [Current visitor widget with no visible questions beside the composer](../references/visitor-widget-topics-before.png).

- [x] Move the published topic buttons from their current introductory position to a strip directly above the textarea and Send button. The strip remains visible while the visitor scrolls through a long transcript and after the first message; it does not cover the transcript or shrink the composer to an unusable size.
- [x] Arrange the buttons in exactly two rows when topics are available, with horizontal overflow for additional questions. Do not wrap into a third row or make the whole chat panel scroll sideways. Keep each button label readable, allowing up to two text lines within a button rather than clipping a long question. The strip is hidden cleanly when there are no published topics.
- [x] Support touch swiping, trackpad/shift-wheel horizontal scrolling where available, and keyboard access. Each question is a real button with a visible focus state. A keyboard-focused button scrolls into view; the strip has an accessible label and does not trap focus. Avoid relying only on a scrollbar that may be hidden on touch devices; provide a subtle overflow cue or controls if needed.
- [x] Clicking a suggested question uses the existing published topic/question send flow once, shows the visitor's selection in the transcript, and prevents duplicate sends while pending. Preserve typed questions and the separate contextual choice buttons that appear inside a bot message for ambiguous matches.
- [x] During staff handoff or a claimed conversation, a clicked suggestion must follow the current conversation state: it can be sent as a visitor message to staff, but must not restart automated answers or create a second conversation. Keep the control's wording clear enough that it does not promise an instant bot answer during staff takeover.
- [x] Check the 360px embed, a narrow phone viewport, desktop, and a long transcript. The two-row strip, status/error text, textarea, Send button, and safe-area spacing remain visible and usable without overlap. Verify no-topics, one-topic, many-topics, long-label, pending-send, and staff-takeover states. Use the project's reduced-motion behavior if scroll controls or transitions are added.

## Context

The widget currently renders topic buttons near the introduction only when `messages.length === 0`, using a wrapping `.topics` container. After a conversation starts, the published questions disappear, leaving the area above the composer empty in the supplied screenshot. The user wants two rows of clickable questions fixed with the composer and horizontally scrollable when there are more than fit. The contextual choices inside a bot message are a different interaction and should remain in the transcript.

## Comments

2026-10-27: Captured from the user's screenshot and request. No widget implementation requested in this turn.

## Comments

2026-10-28: IMPLEMENTED (`ready-for-human`).

**Placement and persistence**: the published topic chips moved from the introduction (where they vanished after the first message, gated on `messages.length === 0`) to a `TopicsStrip` pinned directly above the composer, rendered whenever topics exist for the whole conversation — long transcripts keep it visible, and it hides cleanly when nothing is published.

**Two rows, horizontal overflow**: CSS grid with `grid-auto-flow: column; grid-auto-columns: max-content; grid-template-rows: repeat(2, auto)` — chips fill two rows then overflow sideways. `max-content` matters: auto tracks shrink chips to squeeze everything in, which defeats the overflow (found and browser-verified during this ticket). Long labels wrap to at most two lines via a clamp on an inner `<span>` — Chromium buttons ignore `-webkit-line-clamp` on themselves, so a third line used to peek below the clip.

**Scrolling and access**: native touch swipe, trackpad and shift-wheel scrolling; the scrollbar is hidden (touch devices barely show one) and the overflow cue is soft edge fades, tracked by `onScroll` + `ResizeObserver` and shown only on sides that actually have more content. Chips are real buttons with the existing gold focus ring; focusing scrolls the chip into view (`scrollIntoView` nearest), and `scroll-behavior: smooth` applies only under `prefers-reduced-motion: no-preference`. The strip is a labeled group ("Suggested questions") that does not trap focus.

**Send behavior**: chips reuse the existing topic flow exactly (send the rule's first phrase; one optimistic transcript entry). The duplicate-send race is closed with a synchronous `sendingRef` guard — the old state flag alone flipped only after `ensureSession`'s await, so a second click during the first message's session setup could double-send (review finding; behavioral check holds a messages POST for 1.2 s and asserts all 7 chips disable, then exactly one transcript entry). Contextual choice buttons inside bot messages are untouched. During handoff/claim the strip follows the conversation: the picked question goes to staff as a visitor message, no bot reply, no second conversation, and the intro line switches to "Pick a topic to send to staff, or type your question." so the control never promises an instant automated answer.

**Verification**: `tests/embed-smoke.test.ts` pins the strip contract (label, focus scroll, takeover wording, two-row grid, reduced-motion gate, two-line clamp) in its own block. Headless Chromium (production build, scratch DB, `scripts/topics-shots.mjs`) exercised many-topics (7 chips, two rows, 462 px of chips in a 328 px strip), scroll-edge fades both ways, chip-to-transcript flow, handoff takeover, long transcript, one-topic, no-topics, and 360 px/phone/desktop widths — screenshots `references/shots-after/after-widget-topics-{desktop,handoff,long-transcript,phone,360,one,none}.png`. Full suite green; `npm run typecheck` clean; two-agent `/code-review` findings fixed (send race, tripled comment, test splitting, phrases as arrays, pending-send verification).

**Notes**: the widget loader (`public/widget/v1.js`) is untouched — the strip lives in the frame app. No schema changes, so ticket 11 needs nothing new.
