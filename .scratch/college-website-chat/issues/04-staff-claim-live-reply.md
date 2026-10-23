# 04: Staff claim and live reply

**What to build:** A staff member can claim an escalated conversation and reply to the visitor in the same widget. Both sides see the persisted history, even after a temporary connection loss, and staff can close a resolved conversation.

**Blocked by:** 02: Unknown question reaches the shared inbox.

**Status:** resolved


- [x] Claiming is atomic: when two staff members try at once, only one becomes the owner and the other sees the current assignment.
- [x] The claiming staff member can reply, and the visitor sees the message promptly in the same chat.
- [x] Authorized polling delivers new messages promptly; a visitor or unrelated staff session cannot fetch another conversation's messages.
- [x] After reload or reconnect, both sides recover missed messages from the stored conversation.
- [x] Staff can close a resolved conversation; a later visitor question begins a new conversation rather than reopening the closed one.
- [x] Automated API flows cover claim contention, reply, reconnect, authorization, and closure; a browser check demonstrates the live exchange.

## Comments

**2026-10-23 — implemented.**

- **Atomic claim:** migration `0004` adds `claimed_by`/`claimed_at`; the claim is a single conditional `UPDATE … WHERE state = 'awaiting_staff' AND claimed_by IS NULL`. Exactly one concurrent request wins; the loser gets 409 with the owner's display name ("Alice is already helping in this conversation."). Replies and closing are restricted to the current claimer; release/transfer and owner override are ticket 08.
- **Reply:** `POST /api/staff/conversations/[id]/reply` appends a staff message to the same conversation; validated like visitor text. No rate limit on authenticated staff by design (audit accountability arrives with ticket 08's audit records).
- **Live updates:** both sides poll. The visitor frame polls its authorized `GET` every 3 s and re-renders messages plus state banners ("College staff will reply…" → "A college staff member has joined the conversation…"); the staff transcript auto-refreshes through authorized server-rendered polling. Every poll recovers the full stored history, so reloads and dropped connections self-heal.
- **Closure:** the claimer closes; a persisted bot notice ("This conversation has been closed…") lands in the transcript. A visitor message to a closed conversation gets 409 `conversation_closed`, and the widget drops the dead credential and carries the visitor's question into a fresh conversation automatically, so the question is never swallowed by the closure.
- **Authorization:** staff actions verify session, verified email, active account, TOTP, and role (owner/staff) per request plus same-origin CSRF; visitor bearer tokens on staff endpoints get 401. All staff sharing the inbox can read every transcript — the deliberate shared-inbox reading of "unrelated staff session" (write actions are claim-gated); say the word if reads should be claim-scoped instead.
- **Tests:** 58 passing — claim contention (concurrent claims, loser sees owner), reply gating (unclaimed, non-claimer, empty/oversized), reconnect recovery for both sides, closure + fresh conversation, CSRF, and visitor-credential rejection. Typecheck clean. The creation-abuse test (ticket 01 suite) now widens the rate-limit window via a `RATE_WINDOW_MS` test override so it measures the limit, not machine speed under parallel load.
- **Interactive browser check (production build, two tabs):** visitor escalated → staff signed in with password + TOTP → claimed from the inbox → replied → the visitor's frame showed the reply and "staff has joined" banner within one poll interval → staff closed → both sides saw the closure → the visitor's next question opened a fresh conversation and received the seeded bot answer. Two defects found and fixed during the check: the closed-conversation question swallow (carryover) and — from earlier probing — the shared origin-trust list. Note: `next dev` exhibited an iframe full-reload loop (HMR) when embedded; the check ran against `next build` + `next start`, which also makes it a production-build verification.

Notes for the human pass:

- Closing requires a prior claim so every closure is attributable; unclaimed spam escalations must be claimed first. Revisit with ticket 08's release/transfer if you want direct close.
- Staff read access to all transcripts is the shared-inbox interpretation (see above); write actions are claim-gated.
- The claim-contention test runs two claims in one process; SQLite serializes them, and the conditional UPDATE (not the test harness) is what enforces single ownership. Cross-process contention relies on SQLite's write lock on that same statement.
- `BETTER_AUTH_SECRET` rotation invalidates enrolled TOTP secrets (better-auth encrypts them with it) — surfaced during local production-run setup; worth a line in the eventual ops runbook.
- RATE_WINDOW_MS is a test-only env override; production always uses the 60 s default.

**2026-10-23 — accepted as complete.** The human pass accepted the implementation, its browser checks, and the recorded judgment calls as they stand. Status set to `resolved`.
