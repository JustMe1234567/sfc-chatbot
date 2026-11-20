# 47: Keep History compact and default transcript retention to 30 days

**Status:** ready-for-human

**Reference:** [Compact History list supplied by the user](../references/dashboard-history-compact-reference.png)

**What to build:** History should behave like the active Conversations list: show one compact preview row per conversation and open the full transcript only after staff select that row. For new/unconfigured installations, closed conversation transcripts should expire after 30 days instead of being retained forever.

- [x] History initially renders only compact conversation summaries, never every full transcript inline. Each row shows the state, latest-message preview, useful time, and attention marker when applicable.
- [x] Clicking a History row opens that conversation's full transcript in the existing conversation pane, using the same desktop and narrow-screen interaction as the Conversations tab.
- [x] Only one conversation is selected at a time. Returning to History restores the compact list and does not leave expanded transcripts consuming vertical space between rows.
- [x] Long previews are clamped to a small, consistent number of lines with an ellipsis. The full message remains available after opening the conversation; do not place full transcript text in tooltips or accessible names for the list row.
- [x] Ticket 42's row-level **Loading…** feedback applies to History selection so staff know their click registered.
- [x] Preserve keyboard navigation, visible focus, `aria-current` for the selected row, and usable 360px, phone, and desktop layouts.
- [x] Change the effective transcript-retention default from indefinite to **30 days** when no owner setting exists. Existing explicit owner settings continue to win.
- [x] The 30-day clock applies only after a conversation is closed or has otherwise entered retained History under the existing lifecycle. Active conversations are never deleted merely because they are 30 days old.
- [x] Keep the owner control for choosing another retention period. The dashboard clearly states the effective value and warns that expiry permanently removes transcripts and visitor contact details.
- [x] Define upgrade behavior safely: do not silently purge a large backlog immediately on deployment without an explicit migration/launch decision. Tests must cover new installs, explicit overrides, active-chat preservation, the exact 30-day boundary, and upgrade behavior.
- [x] Preserve the existing minimal retention-run record and removal of expired visitor sessions, return links, contact details, and notification rows.

## Decision needed

- Confirm the upgrade rule for existing installations that have no configured retention value. Recommended: set their effective value to 30 days but give the owner a visible warning/grace period before the first destructive sweep, avoiding an unexpected immediate purge of old transcripts.

## Context

Ticket 12 already specifies a compact list with click-to-open transcripts for both Conversations and History, and the current components share the same `DeskEntry`. This ticket makes that parity an explicit acceptance check because the user reported concern that History could consume too much space. Ticket 10 already provides configurable transcript retention, but its unconfigured behavior is indefinite retention. The proposed policy changes only that default; it does not remove owner control.

## Comments

2026-11-05: Filed from the user's request for History to show compact clickable conversation previews rather than entire conversations, plus a proposed one-month lifespan. Thirty days is recorded as the recommended default for privacy and storage hygiene. Marked `needs-info` only for the destructive upgrade/grace-period decision; the compact History behavior itself is fully specified.

2026-11-05: Decision recorded from the user — both halves are in scope. The 30-day clock runs from the moment a conversation is closed or otherwise no longer active; active conversations are never swept regardless of age. This resolves "Decision needed" with **no grandfathering**: the effective 30-day default applies to every installation, so the first sweep after the change removes any closed conversation already past its 30 days. Recorded here as the explicit launch decision the ticket required (nothing is deployed; existing local data is test data). An explicit owner retention setting continues to win, and the dashboard states the effective value with the permanence warning. Status → in-progress.

2026-11-05: Implemented (`Status:` → ready-for-human).

- **Compact History half — parity verified, no product change needed.** History renders through the same `ConversationDesk`/`DeskEntry` as the live desk (ticket 12), and the `[id]` route picks the pane's view from the conversation's own lifecycle, so a History-originated selection keeps the History tab, back link, and compact rail. Pinned by `tests/history-compact.test.ts` (route wiring, row anatomy, 2-line CSS clamp with no JS slicing, single `aria-current`/`data-selected`, ticket-42 row Loading…) and behaviorally by the browser script (row click → transcript in the pane, exactly one selection, returning restores the compact list, no tooltip/accessible-name on rows, keyboard Enter selects).
- **Retention half.** `DEFAULT_RETENTION_DAYS = 30` in `src/settings.ts`; the sweep uses a new three-state `readTranscriptRetention` — absent → the 30-day default (the decided no-grandfathering upgrade rule), explicit period → wins, **invalid/corrupt row → the sweep refuses and logs loudly** (the pre-47 "never delete on the strength of a bad value" guarantee, preserved; caught by two-axis review). The recorded run carries the effective period. Maintenance contract changes from `removedConversations: null` (disabled) to `0` (default ran, nothing expired).
- **Honest copy.** The card now warns removal is permanent (messages, visitor email addresses, return links) and says "Leave empty to use the default of 30 days"; the input's placeholder shows 30; **Clear became "Reset to default"**, and a successful save now syncs the input to the saved state (the old form left the typed value lingering after a clear — pre-existing bug this ticket's rename exposed). Read-only staff summary reads "30 days after closure (the default)". GLOSSARY's Retention-period and Analytics-retention entries updated.
- **Consequence to note:** "keep closed transcripts forever" is no longer expressible — an unset period *is* the 30-day default, and the owner's range is 1–3650 days. The API wire format still reports `days: null` for "no explicit period" so the dashboard can label the default.
- **Tests:** `tests/transcript-retention.test.ts` +3 (default sweep with no grandfathering incl. active-chat preservation and run record; exact 30-day boundary at the default; corrupt-value refusal), `tests/history-compact.test.ts` new (6 pins across two describes); stale pins updated in `maintenance.test.ts` (0 vs null) and `loading-feedback.test.ts` ("Resetting…" verb). Suite 236 passed + 3 env-skipped; typecheck and production build clean.
- **Browser certification:** `scripts/history-retention-shots.mjs` (idempotent) — signs in through the real UI, seeds three closed conversations through the real APIs (one backdated 40 days), and proves the sweep end-to-end: saving 35 days through the real form removes the 40-day transcript now ("1 expired conversation removed now"), the archive visibly shrinks, the recent rows survive; reset-to-default clears the stored row and the form returns to the default state. Zero page errors, zero horizontal overflow.
- **Screenshots:** before = `references/shots-history/before-history-1280.png` and `before-retention-card-1280.png` (old "kept indefinitely" copy); after = `after-history-{1280,760,390,360}.png` and `after-retention-card-1280.png`.
- **Known limitation:** large-text simulation is not in scope here (same px-type situation as ticket 49); browser zoom is the scaling path.
