# 14: Clear the visitor chat and keep the staff transcript

**Status:** ready-for-human

**What to build:** Add a **Clear conversation** action to the visitor chat widget. Clearing removes the old transcript from that visitor's chat view, ends that conversation, and starts a fresh conversation. Staff keep the old transcript in the dashboard's History view and see the new conversation as a separate chat.

**Blocked by:** 12: Messenger-style staff conversation desk with a History view.

- [x] The widget offers a clearly labeled, keyboard-accessible Clear conversation action. Because the visitor loses access to the old transcript, ask for confirmation that plainly says staff will retain the history. Do not present this as permanent deletion.
- [x] After confirmation, the widget immediately shows a blank new chat with a new conversation ID and visitor session. New messages belong only to the new conversation; the old messages never reappear in the widget after reload or polling.
- [x] The server marks the old conversation closed, preserves its messages and staff audit trail, and places it in the staff History view. It removes the old conversation from the staff Active list, including when staff had already claimed it. The new conversation appears as a distinct active item in the staff conversation desk.
- [x] Revoke the old visitor session and any unused return links for the cleared conversation. Old credentials cannot load or post to the old transcript. Staff can read its history but cannot send further replies to it.
- [x] Handle concurrent polling, repeated Clear clicks, and a staff reply or claim racing with Clear. A late response from the old conversation must not restore old messages on the visitor screen or attach them to the new conversation. The action must not create multiple new chats from one click/retry.
- [x] Preserve the existing transcript retention policy: clearing starts the closed-conversation retention clock but does not immediately delete the staff history, notification records, or audit trail. Later configured cleanup may remove the retained transcript as usual.
- [x] Tests cover clear before and after escalation, clear while claimed, the fresh conversation on both sides, old-token and return-link rejection, staff history preservation, duplicate requests, and a late polling response.

## Context

Today the widget can drop an expired or closed visitor session, but it has no deliberate visitor Clear action. Staff closing a claimed conversation already preserves its transcript. This ticket adds visitor-initiated closure and a fresh session while keeping the old record available to staff. "Delete on the user side" means removing the visitor's access and display, not deleting the server-side record.

## Comments

2026-10-26: Captured from the user's request as a separate implementation ticket.

## Comments

2026-10-26: Captured from the user's request as a separate implementation ticket.

Implemented 2026-10-28 (ticket 14). Tests in `tests/conversation-clear.test.ts` (8, all API-level) plus a headless-Chromium walkthrough of the real widget (evidence: `references/shots-after/after-widget-clear-{before,confirm,fresh}.png`). New public endpoint `POST /api/v1/conversations/[id]/clear` (visitor bearer, rate-limited) backed by one store transaction (`replaceConversation`): closes the old conversation unless already closed (staff closure's timestamp preserved, and the shared closing notice is appended), deletes its visitor sessions and unused return links, and gets-or-creates the single successor conversation, returning `{id, token, expiresAt}` in the create route's shape. Migration 0012 adds `conversations.replaced_by` — deliberately not a foreign key, so retention can purge a successor independently. The widget grows a quiet "Clear conversation" row under the composer: first click shows the inline confirmation ("Staff will keep a record of this chat on their side. You lose access to it here, and a fresh chat starts." with Clear chat / Keep chatting), and confirming swaps the stored session for the successor's, blanks the transcript (topic buttons return), and resets handoff/claim/email states. A generation counter in the frame strands every in-flight request from the old chat: polling responses and in-flight sends are discarded at every application point, including after the JSON parse, so a late response can neither repaint the fresh chat nor trigger the 409 carry-over into a second new conversation. Verified end to end in the browser: history rendered → confirm shown → clear → blank chat with swapped session → fresh question answered; server-side old row `closed`, `replaced_by` set, successor `bot_active`.

Judgment calls:

- The store's duplicate-defense is the `replaced_by` link: concurrent double clicks both authenticate with the live credential and the transaction serializes them onto one successor (tested with `Promise.all`); a LATER retry with the already-revoked credential answers 404 and mints nothing. On this driver the whole transaction is synchronous, so the guarded UPDATEs are belt-and-braces; the Postgres store for ticket 11 must preserve the join-don't-duplicate rule (noted in the method).
- The widget's 401/404 fallback on clear (credential already revoked or merely expired) starts a plain fresh conversation without closing the old one — the request cannot authenticate to close it. The inactivity clock ends such a conversation within a day; the fallback is commented in the handler.
- The generation-guard logic itself is browser-verified rather than unit-tested: the repo has no component test harness, and the server-side revocation already makes late polls fail with 404; the guard covers the sub-second response window demonstrated in the walkthrough.
- Clearing discards a half-typed draft along with the transcript — the composer resets with the fresh chat.
- `CLOSING_NOTICE` moved to `domain/conversations.ts` so staff closure and visitor clear append the same record; no other close-route behavior changed.
