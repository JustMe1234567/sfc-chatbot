# 54: Stacked recipient boxes with per-box edit and delete

**Status:** ready-for-human

**Reference:** [Alert recipients form before redesign](../references/alert-recipients-boxes-before.png)

**What to build:** Replace the Staff alert recipients form's single comma-separated text input with **one box per email, stacked as rows**. Each box shows the address with **Edit and Delete options on its right side**; adding another email appends a new box to the stack. This is a UI reshaping of `AlertSettingsForm` (`src/app/dashboard/notifications/alert-settings-form.tsx`) — the save endpoint and validation rules stay exactly as they are.

## The boxes

- [ ] Every saved recipient renders as its own box in a stacked row list (one address per box, one box per row), replacing the comma-separated input entirely. No raw comma-string editing remains.
- [ ] The right side of each box holds two controls: **Edit** and **Delete** — icon buttons (inline pencil/trash SVGs, `currentColor`, consistent with the ticket-52 icon approach) with accessible names, meeting ticket-27 touch-target sizing, keyboard operable with visible focus.
- [ ] An **Add** area (input plus Add button) appends a new email as a new box. Adding does not disturb existing boxes; the new box appears at the end of the stack in place.
- [ ] A fresh install with zero configured recipients shows no boxes, a clear empty hint, and the Add area — never a blank comma input.

## Edit and delete behavior

- [ ] **Edit** switches that box into inline edit mode: the address becomes an input inside the same box and the right side shows **Save / Cancel**. Enter saves, Escape cancels. An invalid or duplicate value keeps the box in edit mode with an inline error and saves nothing.
- [ ] **Delete** removes that box from the stack immediately (see persistence below). When only one recipient remains, Delete on the last box is disabled with an inline explanation — the API requires at least one recipient, and the UI says so rather than letting the action fail.
- [ ] Duplicate and malformed addresses are rejected at Add/Edit time with an inline message naming the problem; the list itself can never hold duplicates.

## Persistence and feedback

- [ ] Each action — add, edit-save, delete — persists immediately by sending the resulting full list to the existing `PUT /api/staff/settings/alert-recipients`. No separate bulk Save button remains, and no new endpoint is added.
- [ ] The acting box shows the ticket-42 pending treatment while its request is in flight (row-level, one at a time); other boxes stay interactive.
- [ ] On success the list settles to the saved state. On failure the row reverts to its previous value and shows the server's error message inline, following the Retry button's error pattern.
- [ ] Server-side validation remains the source of truth: the 1–10 valid-address rules, owner-only role check, and same-origin guard are unchanged, and existing API tests keep passing.

## Accessibility and layout

- [ ] The stack is a semantic list (`ul`/`li`); each box's controls are real buttons with discernible names — never icon-only without a label.
- [ ] Focus is managed across actions: after Delete, focus moves to the next box's controls (or the Add area if the stack emptied to the hint state); after Edit-save or Cancel, focus returns to that row's Edit control.
- [ ] At 360px the address and the Edit/Delete controls stack vertically rather than squeezing; long addresses truncate with an ellipsis and reveal fully in edit mode. The form stays owner-only, exactly where it lives today on the Email alerts page.

## Tests

- [ ] Form behavior tests in the repo's current style: add appends a box and persists; edit updates the address in place; delete removes the box; last-remaining delete is disabled; duplicate/malformed input is refused inline with nothing saved; server failure reverts the row and shows the error.
- [ ] Existing `alert-recipients` API tests pass unchanged.

## Context

Ticket 49 redesigned this page but left the recipients form as a single comma-separated input — the hint literally instructs "Comma-separated email addresses," which is what this ticket removes. The endpoint (`PUT /api/staff/settings/alert-recipients`) already accepts the whole array and validates it (`isValidRecipientList`, 1–10, owner-only, same-origin), so per-action persistence needs only client-side array handling on top of the existing call. The PendingButton component and the Retry button's inline-error pattern are the established feedback idioms to reuse.

## Comments

2026-11-05: Filed from the user's request ("emails… on boxes… on the right side will be the options to edit or delete… adding another email will add it as a box again… more like stacked row") with the current form screenshot as the before reference. Decisions recorded: immediate per-action persistence through the unchanged whole-list PUT rather than a deferred Save button; inline edit-in-place with Save/Cancel; last-box Delete disabled rather than erroring; no new API surface.

2026-11-05: Implemented (`Status:` → ready-for-human).

- **The boxes.** `AlertSettingsForm` rebuilt: a `ul.recipientList` of one box per address (state chip-style row, address truncating with an ellipsis, revealing fully in edit mode), Edit (pencil) and Delete (trash) icon buttons on each box's right — inline SVGs on the ticket-52 stroke grid, 44px targets, accessible names derived from the address (`Edit X` / `Delete X`) through PendingButton's new `ariaLabel`/`ariaDescribedBy` slots. The comma input and the bulk "Save recipients" button are gone; an Add area (input + Add, `type=submit`) appends; the empty install shows a hint and the Add area.
- **Edit in place** swaps the box to an email input with Save/Cancel inside it; Enter saves, Escape cancels (back to that row's Edit with focus restored). Client validation runs per entry through the new exported `isValidRecipientEmail` (same pattern the API enforces) plus a case-insensitive duplicate check — a malformed or duplicate value keeps the box in edit mode with an inline `role="alert"` message and saves nothing. The list can never hold duplicates.
- **Persistence.** All three actions go through one `enqueueMutation` path: apply optimistically, PUT the resulting whole list to the unchanged endpoint, settle to the server's returned list on success ("Alert recipients saved.", `router.refresh()`), revert to the snapshot with the server's message inline on failure. Because other boxes stay interactive while a request is in flight, the PUTs are serialized through a promise queue whose runner recomputes from the latest list via a ref — no in-flight save can be clobbered by the next one, and a double-Enter can only ever produce a harmless inline duplicate error, never a second PUT of stale data (review findings, both fixed).
- **Edge handling.** Delete on the last remaining box is disabled with the inline note ("At least one recipient must stay on the list", `aria-describedby`); Add disables at the API's 10-address ceiling with its own hint; deleting a row re-points or closes an open editor and hands focus to the next box (or the Add area when the stack emptied); row indexes shifting under queued work are captured before the await.
- **Layout.** `.recipient*` styles inside the dashboard tokens; below 480px the address takes its own line and the controls drop beneath it (verified live at 360px: stacked rows, zero overflow).
- **Tests.** `tests/alert-recipients-boxes.test.ts` (12 pins: list semantics with no comma input/bulk Save, accessible names, Enter/Escape edit, immediate PUT through one shared path, inline validation, last-box disable, pending verbs, serialization, focus management, CSS floors + stacking). Pin updates: alerts-ui's body-shape pin now matches the shape (`JSON.stringify({ recipients:`) rather than a variable name; loading-feedback's verbs for this form are Saving/Deleting/Adding. `scripts/alerts-shots.mjs` drives the new Add flow and its tab-through targets `recipient-add`; `scripts/recipients-shots.mjs` (new, idempotent light-wipe) walks the whole contract live on real PUTs — including a forced 500 via route interception proving revert + inline error + successful retry, and the 360px stacking assert.
- Suite 286 passed + 3 env-skipped; typecheck and production build clean. Screenshots: before = `references/alert-recipients-boxes-before.png` (user-supplied); after = `references/shots-recipients/after-recipients-{1280,360}.png`.
