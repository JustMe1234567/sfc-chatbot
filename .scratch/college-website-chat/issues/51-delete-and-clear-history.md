# 51: Delete and clear conversation history behind a confirmation dialog

**Status:** ready-for-human

**Reference:** [History tab before delete/clear controls](../references/dashboard-history-delete-before.png)

**What to build:** Give staff destructive controls on the dashboard History tab (`/dashboard/inbox/history`): a per-row **Delete** for a single closed conversation and a **Clear history** action that removes every closed conversation at once. Both are irreversible hard deletes and both must be confirmed in a modal popup before anything is removed. Today the History list is read-only — rows render state, preview, and time, with no actions at all.

## Confirmation dialog

- [x] Both Delete and Clear history open an in-page modal dialog before anything is deleted. Never `window.confirm`.
- [x] The dialog has `role="dialog"` and `aria-modal`, a heading naming the action, and body text stating the deletion is permanent and removes the transcript and the visitor's contact details. Single delete identifies which conversation (state + time); Clear history states how many closed conversations will be removed.
- [x] Cancel is the safe default. Escape, backdrop click, and Cancel all close the dialog with nothing deleted.
- [x] Opening the dialog moves focus into it; closing returns focus to the trigger that opened it. Only one dialog is open at a time.
- [x] The confirm button is visually distinct as destructive (red treatment), and while its request is in flight it uses the ticket-42 pending treatment and the dialog controls disable.
- [x] The dashboard has no shared modal component today; introduce a small reusable one in the dashboard styles rather than a one-off.

## What deletion covers

- [x] Only **closed** conversations are deletable. History rows in `claimed`, `waiting`, or any live state render no Delete control; the workflow for those is to close the conversation first, then delete. The API enforces this too, refusing non-closed ids with a clear error.
- [x] Clear history removes **all closed conversations only**. Claimed/waiting rows survive and remain listed afterwards.
- [x] Deletion reuses the existing transactional purge primitive `purgeClosedConversation` (messages, return tokens, visitor sessions, notification rows, audit-log detachment, then the conversation row) in **both** the SQLite and Postgres stores. No new deletion code path is introduced.
- [x] A visitor whose closed conversation was purged gets the same fresh-chat behavior as a retention sweep: a stale session or return link starts a new conversation.

## Row structure and access

- [x] The per-row Delete control is **not nested inside the row's `<Link>`** (invalid HTML and it would hijack navigation). Restructure `DeskEntry` so the Link and the Delete control are siblings inside the row, while keeping the ticket-42 row-level pending hint working — `useLinkStatus` still needs its consumer inside the Link.
- [x] The Delete control meets the ticket-27 touch-target sizing, shows visible focus, and stays usable at 360px width alongside the existing row content.
- [x] Clear history sits with the History section heading. It is hidden (or disabled with explanation) when there are no closed conversations to remove.

## Permissions

- [x] Per-row Delete is available to any staff role, matching the other desk actions (claim/close/release).
- [x] Clear history is **owner-only**, matching where the other bulk-retention controls live (the Email alerts page hides retention settings from non-owners).

## API and resulting state

- [x] New staff API routes follow the existing conventions (per-id action subroutes and bulk routes like `sessions/revoke-all`), guarded by `requireStaff` with the role rules above. Suggested: `POST /api/staff/conversations/[id]/delete` and `POST /api/staff/conversations/clear-history`.
- [x] Success refreshes the desk list. Failures surface an inline message in or beside the dialog, following the Retry button's error pattern.
- [x] Deleting or clearing the conversation whose transcript is currently open returns staff to the History list, never a missing-conversation view.
- [x] After Clear history the History empty state renders; claimed/waiting rows (if any) remain.

## Tests

- [x] Store/domain tests: single delete refuses non-closed ids; clear removes only closed conversations and leaves claimed/waiting rows; both the SQLite and Postgres stores honor the same contract.
- [x] API tests: unauthenticated calls are rejected; Clear history is rejected for non-owners; non-closed delete is refused; happy paths return success and the data is gone.

## Context

History is `ConversationDesk view="history"` fed by `summarizeConversationHistory`, rendered as one `DeskEntry` per conversation — each row a single `Link` wrapping all content so `useLinkStatus` can report navigation (ticket 42). The purge primitive and its closed-only guard already exist from the retention work (ticket 10): `store.purgeClosedConversation(id)` is transactional and returns `false` for non-closed conversations in both stores. Ticket 47's retention sweep already relies on it, so this ticket's actions are the manual, staff-triggered equivalent of that sweep. Nothing here changes automatic retention behavior, retention settings, or the 30-day default.

## Comments

2026-11-05: Filed from the user's request ("delete history, or clear history and a popup will show up") with the current History tab screenshot as reference. Decisions recorded: modal dialog rather than `window.confirm`; deletion restricted to closed conversations to preserve the existing purge invariant and protect live visitor/staff sessions; owner-only for the bulk clear since it mirrors retention governance, staff-level for single deletes since that matches desk actions; reuse `purgeClosedConversation` rather than adding a second deletion path.

2026-11-05: Implemented (`Status:` → ready-for-human).

- **Shared modal** (`src/app/dashboard/confirm-dialog.tsx`, the dashboard's first reusable dialog): `role="dialog"` + `aria-modal`, labelled heading, body slot, inline `role="alert"` error, safe Cancel focused on open, Tab wrap among dialog controls, Escape/backdrop/Cancel all close (backdrop `preventDefault`s the blur-to-body mousedown so restored focus isn't stolen), destructive red confirm carrying the ticket-42 pending verb, both controls disabled in flight. Focus returns to the trigger on every close path.
- **Controls** (`inbox/history-actions.tsx`): per-row Delete (aria-label "Delete this conversation", dialog identifies by state + the row's displayed time — never transcript text) and owner-only Clear history (states the exact closed count and that claimed conversations are kept), both hidden/refused appropriately; success closes, refocuses the trigger, refreshes the desk, and navigates back to the History list when the deleted conversation was the open one.
- **Row structure**: `DeskEntry` renders a wrapper with the Link and Delete as siblings (grid `minmax(0,1fr) auto`), only for `item.state === "closed"`; the `useLinkStatus` consumer stays inside the Link so ticket 42's Loading… hint still works. 44px target, gold focus ring, verified at 360px and 390px with zero overflow.
- **APIs**: `POST /api/staff/conversations/[id]/delete` (any staff via `loadStaffConversation`; 404 unknown, 409 with clear message for non-closed, and the load→purge race re-distinguishes 404-gone from 409-reopened) and `POST /api/staff/conversations/clear-history` (owner-only; enumerates via `store.listConversationsByState("closed")` so claimed/waiting rows are never even loaded). Both reuse `purgeClosedConversation` — no second deletion path, same fresh-chat behavior as the retention sweep. The static `clear-history` segment takes precedence over `[id]` by Next routing; ids are UUIDs so no collision.
- **Deliberate small extension (scope note):** ticket 08's staff-disable confirmation converted from the browser's `window.confirm` to the shared dialog, completing the ticket's "reusable rather than one-off" intent; its error now surfaces inside the dialog and "Disabling…" moved onto the dialog's confirm control. The disable API is untouched.
- **Tests**: `tests/history-delete.test.ts` (10: store purge closed-only refusal + data gone; delete API auth/happy/non-closed-refusal/second-delete-404; clear-history owner-gating + closed-only survival; modal/no-window.confirm pins, sibling-structure pin, owner gate, pending verbs). `tests/loading-feedback.test.ts` updated for the disable conversion. Suite 253 passed + 3 env-skipped; typecheck + production build clean.
- **Browser certification** (`scripts/history-delete-shots.mjs`, idempotent full-wipe scratch DB): signs in through the real UI, seeds 3 closed + 1 quiet-claimed conversation through the real APIs, and walks the whole contract live — Delete only on closed rows, focus into dialog, Escape/backdrop/Cancel close without deleting with focus returned, confirm deletes, Clear history names the count and spares the claimed row (then hides at zero closed), deleting the open transcript returns to the History list, no overflow at 360/390. Screenshots in `references/shots-history-delete/`.
- **Review fixes applied** (two axes): `listConversationsByState("closed")` instead of filtering every conversation client-side; race branch now distinguishes 404 from 409; dead response-payload parse dropped; dialog focus no longer reset by pending flips; 360px asserted (was 390 only); GLOSSARY gained **Delete (history)** and **Clear history** entries.
