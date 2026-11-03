# 39: Move Clear conversation into a header menu (⋯) like the reference widget

**Status:** ready-for-human

**Reference screenshot:** [Another college chatbot: ⋯ header menu with "New conversation", "Email me this conversation", "Copy conversation", "End chat"](../references/visitor-widget-header-menu-reference.png).

**What to build:** Ticket 14 placed "Clear conversation" as a row **under the composer** with an inline confirm. Move it to the widget **header** as a menu, in the style of the reference image — for now the menu contains only this one action:

- [x] A menu button (horizontal-ellipsis "⋯" icon, refresh-style icon on the item is optional) sits in the widget header beside the close (×) button, inside the existing crest-plate header bar (`frame/page.tsx` header; coordinate with ticket 16's plate so the header stays visually clean).
- [x] Clicking it opens a small dropdown menu anchored to the button, containing one item: **"Clear conversation"** (glossary's canonical label — do not rename to "New conversation"; the reference image's other items — email transcript, copy, end chat — are explicitly OUT of scope, but the menu should be trivially extensible for them later).
- [x] The item keeps ticket 14's exact behavior: inline confirmation before clearing (do not clear on a single click), then `POST /api/v1/conversations/[id]/clear`, fresh successor conversation, session swap, generation guards — no API or store changes.
- [x] The under-composer "Clear conversation" row is removed; the space it freed accrues to the transcript (ticket 38's dominance goal).
- [x] Same visibility conditions as today: hidden/disabled before the conversation has any messages, and during a pending send (the `sendingRef` guard from ticket 18 applies to the menu item too).
- [x] Keyboard + SR accessible: the menu button has an accessible name (e.g. "Conversation options"), `aria-expanded`, and `aria-haspopup`; opening moves focus into the menu, Escape closes the menu first and returns focus to the button, arrow keys move between items (WAI-ARIA menu/disclosure pattern — a simple disclosure with buttons is acceptable if arrows are supported); item is a real button with visible focus ring and ≥24px hit target (issue 27).
- [x] Escape layering is unambiguous: Escape closes the menu first, then cancels the clear-confirm, then closes the widget (coordinates with issue 29's Escape-order item — resolve both together if 29 lands first).
- [x] Menu styling follows the widget's tokens (ticket 13/15/16 system): white surface, gold focus ring, entrance animation only under `prefers-reduced-motion: no-preference`.
- [x] No overlap/clipping at 360px, phone, and desktop widths — the dropdown must not be cut by the iframe edge; a long transcript with the menu open still renders correctly.
- [x] Update the affected tests: ticket 14's `tests/conversation-clear.test.ts` is API-level (unaffected) — the widget-level pins (wherever the clear row is asserted, e.g. embed-smoke or topics-shots scripts) move to the menu path: menu opens, confirm clears, transcript resets, staff keeps history.

## Context

The user showed a reference chatbot whose header has a "⋯" overflow menu ("New conversation / Email me this conversation / Copy conversation / End chat") and wants the same placement for our clear action — "for now, just moving the clear convo to the top". This amends ticket 14's under-composer placement (its confirm-guard and successor semantics carry over unchanged) and frees composer-adjacent space for ticket 38. The glossary term is **Clear conversation** ("The visitor's action to end the current chat and start a fresh one") — keep the label; if the user later wants "New conversation" wording that's a one-line follow-up.

## Comments

2026-11-01: Filed from the user's request and reference screenshot. Amends ticket 14 (placement only). Coordinates: ticket 35 (launcher toggle — header button cluster grows: ⋯ + ×), ticket 38 (transcript dominance gains the freed row), issue 27 (hit targets), issue 29 + Escape layering above.

2026-11-03: Implemented the accessible header menu and anchored confirmation without changing the clear API/session flow. Added widget contract coverage plus a Playwright proof for focus/Escape behavior, successor swap, transcript reset, retained history, and 390/360px bounds; focused tests (18/18) and typecheck pass. Full suite: 184 tests pass; the unrelated restart-persistence suite cannot bind/reach its nested Next dev server in this sandbox. Codex browser visual verification was attempted at localhost and the LAN address, but both navigations timed out due the browser network sandbox. An elevated Playwright run reached the app but stopped when the pre-existing topics setup did not render its expected suggested-question strip, before the ticket 39 steps; human visual verification remains appropriate.

2026-11-04 (ticket 41 session): corrected the browser-proof's retention assertion while running the headless journey for ticket 41 — it fetched the old transcript **with the revoked visitor credential**, which the Clear-conversation contract revokes immediately, so the check was unpassable as written (and this session's own Playwright run had stopped before reaching it). It now asserts the checkable contract (old credential → 401/404) and points staff-retention proof at `tests/conversation-clear.test.ts`. The menu flow itself (focus, Escape layers, successor swap, transcript reset) passes end-to-end.
