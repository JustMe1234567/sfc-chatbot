# 36: Topic chips wrap individually — a long phrase takes two lines, a short phrase one

**Status:** ready-for-human

**Reference screenshot:** [Current strip: Admissions and Fees stacked, chips single-line](../references/visitor-widget-chip-line-wrap-before.png).

**What to build:** Amend ticket 18's two-row topics strip so line-wrapping is per chip, not per strip:

- [ ] The strip area stays at most two rows tall and scrolls horizontally (unchanged from ticket 18).
- [ ] A **short** phrase renders as a single-line chip, one row tall.
- [ ] A **long** phrase wraps to exactly two lines inside its own chip — the chip spans both strip rows — rather than overflowing, being clipped to one line, or forcing a third row.
- [ ] Mixed heights are expected and fine: chips are not forced to a uniform two-line height; only phrases long enough to need it take two lines. ("Not both phrase options take two rows — just a phrase option can take two rows.")
- [ ] Chips flow left-to-right in the strip; the screenshot's stacked-vertical arrangement (one chip per column position) must not be the resting look when several short topics exist.
- [ ] A two-line chip's text never clips mid-line: both lines fully visible, with the existing two-line clamp as the cap (no third line ever).
- [ ] Preserve every ticket-18 behavior: touch swipe, trackpad/shift-wheel scroll, keyboard focus with scroll-into-view, accessible label, no focus trap, takeover wording, single-send guard, hidden-scrollbar + overflow cue, reduced-motion gating.
- [ ] Update the strip-contract pins in `tests/embed-smoke.test.ts` (they assert the ticket-18 grid contract) and re-run the headless visual checks (`scripts/topics-shots.mjs`), adding a long-label + short-label mix case.

## Context

The user reviewed the current strip (screenshot: "Admissions" and "Fees" stacked vertically, each on one line) and wants the natural chat-widget look: chips in a horizontally scrollable flow where each phrase wraps within itself — long phrases stand two lines tall, short ones stay single-line. Ticket 18 already clamps a long label to two lines inside the chip; what's being specified here is that this wrapping is per chip and that the two-row height budget belongs to the strip, while individual chips may be one or two lines. Grid mechanics are the implementer's call (e.g. single-row flow with `grid-row: span 2` for two-line chips, or flex-wrap-free column flow with per-chip line clamps) as long as the acceptance boxes hold at 360px, phone, and desktop widths.

## Comments

2026-11-01: Filed from the user's request and supplied screenshot. Builds on ticket 18 (`ready-for-human` — this ticket amends its layout, so ticket 18's human pass should follow 36 or be revisited after it lands). Coordinate with 35 (launcher toggle) if implemented together — both touch the widget frame's lower region.

2026-11-01: Implementation decision: the strip uses a single non-wrapping horizontal flex flow. Each chip keeps its natural height; labels are capped at two lines, so short chips stay one line and long chips grow independently without creating a vertically stacked resting layout.

2026-11-12: Status flipped to ready-for-human — commit 6dfb702 (fix(widget): flow topic chips horizontally, 2026-11-01). Verified live today: the strip is a single non-wrapping horizontal flex flow (flex-wrap: nowrap, align-items: flex-start — frame.module.css) where each chip owns its natural height with the two-line clamp as the cap: short phrases single-line, long phrases wrap within their own chip, no stacked-vertical resting layout, strip stays two rows tall and scrolls horizontally. All ticket-18 behaviors preserved (touch swipe, wheel scroll, focus scrollIntoView, hidden scrollbar + fades, reduced motion). Pins: the updated strip-contract block in tests/embed-smoke.test.ts; browser geometry evidence refreshed in scripts/topics-shots.mjs and references/shots-after at commit time.
