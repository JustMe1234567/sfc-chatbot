# 27: Bring widget touch/click targets up to 24px minimum

**Status:** ready-for-human
**Priority:** P2 — a11y blocker for browser testing (spec story 2)
**Found by:** pre-testing audit 2026-10-30 (a11y pass, line-cited)

**What to build:** Several widget controls are smaller than the WCAG 2.5.8 24×24 px minimum: the header close button (~28px box but small hit area, `frame.module.css:95-104`), the email "No thanks" decline (~15px tall, `frame.module.css:291-301`), "Clear conversation" (~20px, 450-458), email Save (~26px, 276-285), and the clear-conversation confirm buttons (~26px, 490-515).

- [x] Every interactive widget control has a hit target of at least 24×24 px (transparent padding counts; visual size may stay compact).
- [x] The decline and clear-conversation links/buttons are the priority — they end the visitor's safety net and are the smallest today.
- [x] Spacing between adjacent small targets is sufficient that a touch on one cannot trigger its neighbor (WCAG 2.5.8 spacing exception).
- [x] The 360px embed still fits without the composer shrinking to an unusable height (ticket 18's constraint).

## Comments

2026-10-30: Filed from the audit. Sizes were measured from the CSS boxes cited; re-verify visually during the browser phase.

2026-11-11: IMPLEMENTED (`ready-for-human`).

**Re-inventory first** (the ticket's cited lines predate the 38/39/43/46/66/67 widget rewrites): the email **"No thanks" decline and Save controls no longer exist** — ticket 66's contact gate replaced the email box (only the text-only `.emailNote` class remains, used by no control), so box 2's decline priority is vacuously satisfied. Clear conversation's successors under ticket 39 — the header menu button, the menu item, and the confirm pair — are exactly the safety-net controls, so they got the only code change and the closest measurement.

**Code change**: `min-height: 24px` floors on `.confirmClear`/`.confirmKeep` (frame.module.css) — the only controls whose height derives from font metrics (12px fonts leave ~2-4px headroom depending on platform); measured 30px on this machine with the floor. Everything else already reaches 24px by fixed box (close/menu 32×32, menu item 36) or padding (chips 29.6+, pills ~40, send stretches with the composer row, gate inputs ~35) — verified by measurement, no visual change anywhere.

**Certification** (`scripts/cert27-touch-targets.mjs`, production build on a scratch Postgres db, headless Chromium): walks gate → fresh → active (linked rule answer) → menu open → confirm open → unknown-question offer → waiting lock, measuring every interactive control's rendered box at **360px and desktop**; fails below 24×24. All targets pass (smallest real target 29.6px: strip chip and offer button). Screenshots in `references/ticket27/` (7).

**Box 3**: no small targets remain, so the 2.5.8 spacing exception is satisfied vacuously — the script still refuses adjacent-target *overlap* and records gaps as evidence (confirm pair 6px, suggestion pills 10px, header menu↔close 2px between two 32px targets, which the criterion does not constrain). **Box 4**: composer measures 61.5px tall at 360px with zero horizontal overflow — ticket 18's constraint holds. **Judgment call**: the in-bubble "Visit the college page" link measures 142×20 — inline flow inside the bubble (WCAG 2.5.8 inline exception, "size constrained by the line-height of non-target text"); measured, reported, and held to a readable floor rather than 24px.

**Tests**: embed-smoke 27-block pins the CSS floors + the cert's claims. Full suite 452 passed / 3 skipped / 0 failed (55 files); typecheck clean. Concurrent-session note: ticket 25/26 work landed in the same tree mid-run (page.tsx focus/role edits, new widget-open-focus test) — excluded from this change's diff and commit; embed-smoke's 25-block passing confirms their edits are consistent with this ticket's cert walk.
