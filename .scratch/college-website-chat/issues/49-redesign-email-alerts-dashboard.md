# 49: Improve the Email alerts dashboard UI

**Status:** ready-for-human

**Reference:** [Current Email alerts page](../references/dashboard-email-alerts-before.png)

**What to build:** Redesign the staff dashboard's Email alerts tab so configuration is easier to scan, forms have a clear hierarchy, and the delivery history is compact and actionable without changing any settings or notification behavior.

- [ ] Keep the existing Email alerts navigation, permissions, settings APIs, validation, save/clear behavior, retry behavior, and loading feedback unchanged.
- [ ] Introduce a clear page hierarchy: a short delivery-setup introduction, a balanced settings area, and a distinct delivery-history section below it.
- [ ] Replace the current uneven layout where Support hours and Transcript retention span the full page while Staff alert recipients sits in a narrow column. Use a responsive card/grid layout with intentional proportions at desktop, tablet, and phone widths.
- [ ] Improve Support hours form grouping: visible field labels, a compact Open days control, paired Opening/Closing time fields where space allows, and clearly separated Save/Clear actions. Preserve the existing IANA time-zone semantics and validation.
- [ ] Improve Staff alert recipients form hierarchy and helper copy. Keep comma-separated entry compatible with the existing API, make the email field comfortably touch-sized, and retain the existing save confirmation/error message.
- [ ] Make Transcript retention compact but prominent, including the destructive nature of deleting closed transcripts and the existing cleanup result. Keep the owner-only setting and current allowed range.
- [ ] Present delivery history as a compact, readable list/table of rows rather than a long sequence of oversized cards. Each row must show status text, attempt count, timestamp, recipient/error summary, and the existing Retry action when applicable.
- [ ] Use semantic status badges for Delivered, Pending, and Failed. Status must not rely on color alone; retain readable text and accessible contrast.
- [ ] Add a small summary of delivery totals near the history heading without implying that a delivered email guarantees visitor receipt.
- [ ] Add a useful empty state when no alerts exist, explaining what will appear after the first handoff alert.
- [ ] Keep all controls keyboard accessible with visible focus, labels tied to inputs, inline status/error announcements, and touch targets at least 44px high.
- [ ] Verify 1280px desktop, 760px tablet, 390px phone, keyboard navigation, reduced motion, large text, and no horizontal overflow. Do not use emoji as structural icons; use existing text/status treatments or the project's established vector icon style.
- [ ] Add focused UI/browser coverage for the new layout, status labels, responsive stacking, empty state, retry visibility, and preservation of existing form submissions. Capture before/after screenshots in the ticket comments.

## Context

The supplied screenshot shows the current page: a very wide Support hours card, a narrow Staff alert recipients card beside large unused space, a full-width retention card, and a long stack of repetitive notification cards. This ticket is a presentation and information-architecture improvement only. Ticket 42's pending/loading behavior and ticket 10's retention semantics remain authoritative.

## Comments

2026-11-05: Filed from the user's request for a UI improvement of the Email alerts tab, using the supplied screenshot as the before reference. The UI/UX Pro Max skill was installed into the project at `.agents/skills/ui-ux-pro-max/` as requested. No application source changes are included in this ticket.

2026-11-05: Implemented (`Status:` → ready-for-human).

- **Provenance note:** the redesign itself was the in-tree work committed as `735f506` during ticket 44 (page restructure + alerts CSS). This ticket's implementation audited that work checkbox-by-checkbox, filled the gaps, and added the required verification.
- **Audit result:** every structural box was already satisfied by `735f506` — delivery-setup intro, responsive `alertSettingsGrid` (1.5fr/0.8fr → 1col at ≤860px, day picker 7→4 columns at ≤560px), Support-hours grouping (labels, fieldset legend, paired time fields, separated Save/Clear), recipients hierarchy, compact retention with destructive copy and cleanup result, compact history rows, semantic Delivered/Pending/Failed badges with visible text, conditional totals, empty state, 44px inputs, no emoji icons, behavior/permissions/APIs unchanged.
- **Gaps fixed:** the Retry button referenced a nonexistent `styles.signOut` and rendered unstyled → real `.retryButton` (ghost style, 44px floor); day-picker tiles 42px → 44px; the shared dashboard header's identity row could not fit one line at 390px and pushed the page sideways → `flex-wrap` under the existing ≤760px stacked layout; "Delivered" now carries the receipt caveat ("it cannot confirm the recipient read it").
- **Verification:** new `tests/alerts-ui.test.ts` (7 pins: sections/grid/permissions gate, badge text mapping, totals + conditional failed pill + receipt caveat, empty state, retry-only-on-failed + real class, 44px floors, the three settings APIs preserved, no emoji icons); new `scripts/alerts-shots.mjs` (idempotent: wipes enrollment + alert history per run) — signs in through the real UI, asserts hierarchy and the empty state, performs a real recipients save that survives reload, seeds sent/failed/pending rows, asserts badges/totals/retry-only-on-failed, drives the REAL retry endpoint to recovery ("2 delivered"), captures `after-alerts-1280/760/390.png` with zero horizontal overflow, a reduced-motion shot, and a full tab-through (9 stops, all controls reachable).
- **Screenshots:** before = `references/dashboard-email-alerts-before.png` (user-supplied); after = `references/shots-alerts/after-alerts-{1280,760,390,reduced-motion}.png`.
- **Known limitation:** "large text" from the verification box is not simulated — the dashboard's type is px-based (ticket 13), so OS text scaling doesn't reflow it; browser zoom (which the width matrix approximates) is the scaling path. Suite 230 passed + 3 env-skipped (user's dev server holds the Next dev lock); typecheck + production build clean.
