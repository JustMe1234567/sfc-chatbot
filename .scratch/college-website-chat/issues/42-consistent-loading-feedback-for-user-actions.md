# 42: Give every asynchronous user action immediate loading feedback

**Status:** ready-for-human

**What to build:** Clicking an action must never look like nothing happened. Add a small, consistent pending/loading treatment across the visitor widget and staff dashboard, especially conversation actions, forms, authentication, and slower page loads.

- [ ] Inventory user-triggered asynchronous actions across the widget and dashboard. At minimum cover: visitor send and clear; staff claim, transfer/release, reply, and close; sign-in, TOTP, and enrollment; answer-rule save/publish; staff invite/disable; notification retry; and settings/forms that save server-side.
- [ ] Every covered action gives immediate visible feedback in the control that initiated it: replace or augment its label with a concise active verb such as **Sending…**, **Saving…**, **Publishing…**, **Claiming…**, **Retrying…**, or **Loading…**, with a small shared spinner where it improves recognition.
- [ ] Conversation actions are the first priority. Sending a visitor or staff message visibly shows **Sending…** until the request settles; claim, transfer/release, and close communicate their own pending state instead of only disabling silently.
- [ ] Use one reusable pending indicator/button pattern so size, spacing, colors, and motion are consistent. Preserve each button's width where practical to avoid layout jumps.
- [ ] Pending controls disable duplicate submission synchronously, while unrelated safe controls remain usable. Do not use a full-page blocking overlay for an isolated button action.
- [ ] Initial dashboard route/data loads that can show an empty shell receive a lightweight page or section loading state. Background polling and silent refreshes must not repeatedly flash spinners or interrupt reading.
- [ ] Success replaces the pending state with the resulting UI or existing success message. Failure restores the control and shows the existing actionable error; no action remains permanently stuck in a loading state.
- [ ] Accessibility does not rely on animation: use meaningful pending text, appropriate `aria-busy`/live announcements, keep disabled state understandable, and avoid moving focus unexpectedly.
- [ ] Spinner animation runs only under `prefers-reduced-motion: no-preference`; reduced-motion users still see the pending text/state immediately.
- [ ] Check narrow phone, 360px widget, and desktop layouts. Longer pending labels must not clip, overlap, or shift adjacent controls out of reach.
- [ ] Add focused tests for the shared pending pattern and representative flows: visitor send, staff reply or claim, a dashboard settings save, authentication, success recovery, error recovery, and duplicate-click prevention.

## Scope guidance

This is not a request to place a spinner on every network request. Feedback belongs on actions the user deliberately initiates and on genuinely empty initial-loading surfaces. Existing `busy`, `sending`, and `loading` state should be reused and made visible rather than replaced with a new global state system. Keep polling, optimistic transcript rendering, and fast navigation calm.

## Context

Several components already track `busy`, `sending`, or `loading` and disable controls, but many buttons keep their resting label while pending. That prevents duplicate actions but can still feel unresponsive. The user specifically called out conversation interactions and requested simple loading feedback anywhere else it materially improves UX.

Coordinate with ticket 15's purposeful-motion and reduced-motion rules and ticket 13's dashboard form-state consistency. Do not change conversation, authentication, publishing, or settings semantics.

## Comments

2026-11-03: Filed from the user's request for simple, immediate loading feedback so clicks never appear to do nothing, with conversations as the priority and a focused site-wide audit of user-triggered asynchronous actions.

2026-11-04: IMPLEMENTED (`ready-for-human`).

**The shared pattern:** `src/app/dashboard/pending-button.tsx` — while `pending`, the button swaps to its active verb, sets `aria-busy`, and carries the shared spinner (a quiet ring, animation gated on `prefers-reduced-motion: no-preference`; the pending text alone is the reduced-motion feedback). Duplicate submission is blocked in layers: an in-flight latch swallows re-entrant clicks within the handler's tick, the pending flip disables across renders, and each caller's own busy guard remains — the widget's `sendingRef` layering (ticket 18). The latch clears in a microtask after the handler returns, so a handler that bows out (a cancelled confirm, a validation return) cannot wedge the button shut.

**Inventory, all converted:** conversation actions (Claim conversation → Claiming…, Release to inbox → Releasing…, Transfer → Transferring…, Send reply → Sending…, Close conversation → Closing… — split from shared `busy` into per-action pending so each button names its own verb and the old mutual exclusion is preserved via cross-disabling); publish/unpublish (Publishing…/Unpublishing…); rule save, escalation phrases, welcome message, support hours, retention, alert recipients, analytics settings (Saving…, with Clear → Clearing… split into its own pending state so a save never mislabels the Clear button); retry (Retrying…); invite (Creating…); disable (Disabling…); sign-in (Signing in…), TOTP verify + enrollment (Verifying…); sign out (Signing out…) and revoke-all (Revoking sessions…, mutually disabling). Widget: the composer's Send swaps to Sending… with the spinner, `min-width` keeps the composer from shifting — a required local CSS copy because the iframe is self-contained (ticket 16). Dashboard routes gained `src/app/dashboard/loading.tsx` (instant shell in the finished chrome; `router.refresh()` polling never triggers it, so no spinner flash).

**Review** (two-axis `/code-review`) caught and I fixed: a wedge where a cancelled `window.confirm` left the latch set forever (now microtask-cleared per handler); lost mutual exclusion between reply/close and release/transfer (restored via cross-disabling while keeping per-action verbs); Clear mislabeled "Clearing…" during a save (split pending states); sign-out/revoke asymmetry; a `margin-right` divergence between the two spinner copies; and a CSS-Modules build failure (a bare `button[aria-busy]` selector is "not pure" — scoped to a pending-only local class). Accepted as-is: width preservation is `white-space: nowrap` on pending buttons plus the widget's `min-width` — the "where practical" reading, since flowing card layouts absorb small label swaps; behavioral success/error-recovery tests stay at the API seam (no DOM env) with the visitor-send pending verified live in `topics-shots.mjs`; pending states are announced via the label swap + `aria-busy` on the focused control rather than a separate live region.

**Verification:** typecheck clean; full suite **200/200 across 26 files** (new `tests/loading-feedback.test.ts` pins the pattern + the whole verb inventory so a button can never silently fall back to a resting label); headless journey on a production build verified the send button reads Sending… during a held request, with all prior ticket flows green.
