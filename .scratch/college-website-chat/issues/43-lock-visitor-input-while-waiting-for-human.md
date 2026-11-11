# 43: Lock visitor input while waiting for a human agent

**Status:** ready-for-human

**What to build:** After a visitor requests a human agent, temporarily disable the widget composer until a staff member takes over the conversation. Keep the transcript and handoff information visible so the visitor understands what is happening.

- [ ] When the visitor clicks **Chat with a human**, complete the existing escalation flow, then disable the message field and Send button while the conversation is `awaiting_staff`.
- [ ] Show clear inline text near the composer, such as **Waiting for a staff member to take over…**. Do not leave a disabled control without an explanation.
- [ ] Keep the transcript, optional email capture, Clear conversation action, and staff-support-hours message available while waiting.
- [ ] When a staff member takes over and the conversation becomes `claimed`, automatically re-enable the composer without requiring the visitor to reload the page.
- [ ] If the takeover request fails, do not lock the composer. Restore the existing human-request action and show the actionable error.
- [ ] A visitor must not be able to bypass the locked UI by posting messages directly while the conversation is `awaiting_staff`; the API should reject those messages with a stable error. Polling and email submission remain allowed.
- [ ] Closing, clearing, expiring, or otherwise replacing the conversation must preserve the existing behavior and must not leave the fresh conversation locked.
- [ ] The waiting state is keyboard- and screen-reader-accessible, uses `aria-disabled`/`disabled` appropriately, and is announced once when it begins and once when staff take over.
- [ ] Tests cover the request-human transition, direct API rejection while waiting, automatic unlock after takeover, failure recovery, and a fresh chat after Clear.

## Context

Ticket 37 already makes human escalation visitor-consented and pauses automated bot replies. This ticket additionally locks visitor message entry during the short `awaiting_staff` period, then restores two-way chat when staff take over. It does not change the existing handoff email, support-hours wording, or conversation assignment model.

## Comments

2026-11-04: Filed from the user's request: "disable chat when user asks for a human agent." Interpreted as temporarily disabling visitor message entry while the chat is waiting for staff, not hiding or closing the conversation. The transcript and email-return option remain usable, and input returns as soon as staff take over.

2026-11-05: IMPLEMENTED (`ready-for-human`).

**API (the bypass-proof half):** the messages route rejects visitor text **and** choice posts while `awaiting_staff` with the stable 409 `awaiting_staff` ("Waiting for a staff member to take over. You can reply once they join."). The escalation-triggering request-human choice still works because it is posted while `bot_active` — the lock check sits at the choice branch's top so even a repeated offer draw gets the lock, not a stale-offer 400. Under an active claim, picks still land as the visitor's words to staff (ticket 18's claimed-side behavior preserved; its awaiting-side send-during-takeover is superseded). Polling, email submission, and Clear are untouched. The route's four conflict responses now share one `conflictResponse(code, message)` shape.

**Widget:** `composerLocked = handoff && !claimed` disables the textarea, Send, and the topic chips; a `role="status"` line above the composer — "Waiting for a staff member to take over…" — announces the lock once, and the claimed notice (also `role="status"`) announces the takeover, when the composer re-enables through the normal state application with no reload. Transcript, email capture, and Clear stay available. `send()` now removes the optimistic bubble on every final failure path (with the poller restoring truth if a request actually landed), the awaiting_staff 409 hands the typed words back to the composer, and generic failures surface the server's own message. Fresh conversations after Clear/closure/inactivity start unlocked (tests pin it).

**Tests:** new `tests/awaiting-lock.test.ts` (request-human transition, stable 409 for direct text + repeated choice, unlock after claim, failed-request non-lock, fresh-chat-after-Clear). Contract updates where the old behavior was accepted: escalation-flow (follow-up input now rejected; transcript ends on the handoff reply), escalation-alert (rejected input cannot re-alert), ambiguity-handoff (stale selection 409s), conversation-desk + staff-claim-reply (claim hoisted above the follow-up message). embed-smoke pins the lock and announcements.

**Review** (two-axis): all findings P3, applied — transcript choice buttons also lock, the ensureSession-null path drops its bubble, conflict responses consolidated; accepted: the choice-branch lock sits before the rate limiter (harmless unthrottled 409s), text-restore can land in an already-disabled textarea in a two-tab race, and the lock moment can utter twice (log reply + waiting line) — cross-element announcement choreography belongs to issue 25's holistic pass.

**Verification:** typecheck clean; production build clean; full suite **201 passed + 3 skipped** (restart-persistence env-fail: the user's dev server holds the Next dev lock); headless journey on a production build asserts the locked composer, locked chips, and the waiting line live, with every prior ticket flow green.

2026-11-11: Superseded in part by ticket 25 (as this ticket's own review anticipated): the waiting line's `role="status"` moved to the handoff notice, which renders at the same moment (`composerLocked = handoff && !claimed`) and carries the fuller sentence — one announcer per state event, no double reading. The line stays as the lock's visual companion; the claimed notice's announcement is untouched.
