# 28: Dashboard a11y — live transcript region and complete tabs pattern

**Status:** ready-for-human
**Priority:** P2 — a11y, queued (non-gating)
**Found by:** pre-testing audit 2026-10-30 (a11y pass)

**What to build:** Two dashboard accessibility gaps:

1. The staff transcript re-renders every 3s via `auto-refresh.tsx` but has no live region (`conversation-desk.tsx:237-247`), so a screen-reader staff member gets no cue that a visitor replied and must poll the pane manually.
2. The analytics period switch uses `role="tablist"/"tab"` with `aria-selected` but no `tabpanel`, no `aria-controls`, and no arrow-key handling (`analytics-view.tsx:76-90`) — an incomplete tabs pattern that promises keyboard behavior that doesn't exist.

- [x] New visitor/staff messages in the open transcript are announced politely (live region on the transcript or on a status line).
- [x] The period switch either completes the tabs pattern (tabs own panels, arrow-key navigation, `aria-controls`) or downgrades to a labeled toggle group — whichever is honest about the interaction.
- [ ] Verified in the browser phase with keyboard-only navigation.

## Comments

2026-10-30: Filed from the audit; non-gating per the audit's fix gate (staff-side friction, not a broken visitor flow).

2026-11-12: IMPLEMENTED (`ready-for-human`) — boxes 1 and 2; box 3's automated portion done headlessly, the manual pass stays for the browser phase.

**Transcript live region** (`conversation-desk.tsx`): the staff transcript div gains `role="log"` + explicit `aria-live="polite"` (the same pairing as the visitor widget's transcript), keeping its `tabIndex={0}` and "Messages" label. The 3s authorized poll re-renders the server tree with stable `key={message.id}` reconciliation, so new messages append nodes into the live region — exactly what a polite log announces; nothing is re-read wholesale. Serves the desk's active and history views alike (closed conversations receive no new messages, so history browsing stays quiet).

**Analytics tabs** (`analytics-view.tsx`): the switch completed as real tabs rather than downgraded — it genuinely swaps one report region, so the honest pattern is tabs. Each tab now has an `id` and `aria-controls="analytics-panel"`; a single always-rendered `role="tabpanel"` (so the reference never dangles) is labelled by the active tab and contains the report. Roving tabindex (selected tab 0, others −1) makes the tablist one Tab stop; ArrowLeft/ArrowRight move selection AND focus with wrap, Home/End jump; arrows stand down while a load is running (the same signal as the disabled tabs) so keystrokes can't stack fetches. The house reference was the Answers tablist (panels + aria-controls); the Answers arrow-key behavior, if ever wanted, is out of this ticket's scope.

**Bug found by certification**: the load-time `disabled` on the tabs *blurs the focused tab* (disabled elements drop focus), so after every arrow-driven period change focus fell to `<body>`. Fixed with a `keyboardFocusRef` arrow-path flag plus a settle-effect that refocuses the selected tab when loading ends — and its dependency is `loading` alone: keyed on `period` too, the effect re-ran on the selection commit (where `loading` still read false), focused a beat before the disable blurring, and consumed the flag — exactly the failure the first cert run caught. Mount and click paths never set the flag, so page load steals no focus.

**Certification** (`scripts/cert28-dashboard-a11y.mjs`, production build on a scratch Postgres db): owner sign-in with fresh TOTP enrollment; keyboard-only tabs walk (Tab reaches the selected tab first; ArrowRight → 30d with focus restored and the report genuinely reloading to 30 rows; wrap to Today; ArrowLeft; Home/End; panel/aria-controls/roving-tabindex asserted at each step) and the desk transcript live region (labelled, focusable, and a second visitor message arriving through the poll appends into the log without navigation). Screenshots in `references/ticket28/`.

**Tests**: `tests/dashboard-a11y.test.ts` pins both behaviors at source level; ticket 63's desk-layout pin (exact attribute string on the transcript div) updated to the multiline form with the same guards. Full suite 455 passed / 6 skipped with only the environmental restart-persistence failure (the recorded dev server on :3000 holds the Next dev lock — LOCALHOST.md) and one transient failure from a concurrent session's mid-edit tree (notifications page), which passed on rerun. Concurrent sessions landed tickets 25/26/27 in the same tree during this work.
