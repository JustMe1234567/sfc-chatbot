# 104: End the visitor's chat after an Email or Phone request

**Status:** needs-info
**Category:** enhancement (visitor flow + desk semantics)
**Priority:** P1
**Source:** Boss feedback relayed by the owner, 2026-11-22 (feature area 3 of 3)
**Related:** [69: Contact request flow](69-confirm-escalation-and-offer-contact-channel.md) (the Email/Phone path this ticket changes the outcome of), [14: Clear visitor conversation, keep staff history](14-clear-visitor-conversation-keep-staff-history.md) (the fresh-successor mechanism), [66: Required pre-chat contact](66-require-visitor-contact-before-chat-and-relabel-status-colors.md) (the gate a new chat returns to), [103: Handoff chat UI](103-admissions-advisor-handoff-chat-ui.md) (owning the Chat path's UI), [102: Role rename](102-admin-and-admissions-advisor-roles.md) (who "advisor" is), [12: Conversation desk](12-messenger-style-conversation-desk.md), [44: Activity/attention tiers](44-chat-status-colors-and-sound-notifications.md)

## Requirements from the feedback (verbatim, preserved)

- End the visitor's chat session after they choose Email or Phone.
- Show confirmation of the selected contact method.
- Provide a "Start a new chat" action.
- A new chat creates a separate conversation.
- Keep the Email or Phone request open in the dashboard until an advisor
  marks it contacted.
- Do not change the live Chat handoff flow.

## Current behavior (inspected 2026-11-22)

The Email/Phone outcome lives in `recordMediumRequest`
(`src/app/api/v1/conversations/[id]/messages/route.ts:130-157`), reached via
the persisted two-step prompt (clicked Handoff Option or typed Handoff phrase
→ "Would you like a staff member to join this chat?" → "No, contact me
another way" → Email | Phone). Today it:

1. Creates exactly one open contact request with that medium (guarded insert,
   one-open-per-conversation is a DB guarantee — partial unique index,
   `migrations/0017_contact_requests.sql` / `migrations/postgres/0007_contact_requests.sql`).
2. Promotes the temporary contact details into the saved contact list (ticket 69).
3. Appends the bot confirmation — masked destination, support-hours-aware
   (`contactRequestConfirmation`, `src/domain/contactRequests.ts:68-81`).
4. **Leaves the conversation `bot_active`** — the visitor can keep chatting,
   the bot keeps answering, and the desk shows the persistent red
   **Contact Me** status until staff use **Mark contacted** (owner+staff only;
   the button renders on the desk pane only while the conversation is in the
   Active view — `selectedContactBadge && selectedActive`,
   `src/app/dashboard/inbox/conversation-desk.tsx` ~line 311; the older
   conversations page has its own `MarkContactedButton` in
   `src/app/dashboard/conversations/[id]/conversation-actions.tsx:35`).

The visitor-session substrate: one stored credential in chatbot-origin
session storage (`src/lib/visitorSession.ts`); the widget's Clear flow
(`src/app/widget/frame/hooks/useClearFlow.ts`) POSTs
`/api/v1/conversations/[id]/clear`, which ends the current chat server-side
and returns one fresh successor conversation (ticket 14) that starts at the
contact gate (ticket 66). A 401/404 from any request drops the stored
session and returns the widget to the gate; the next accepted form submission
creates a brand-new conversation with its own id.

## What changes and what must not

- **Ends:** after the visitor picks Email or Phone, their session ends — they
  cannot keep messaging in that conversation. The confirmation message must
  remain the last thing they see (persisted transcript row, so the wording is
  identical to today's `contactRequestConfirmation` — requirement 2 is
  already implemented content-wise; the change is that it becomes a
  terminal view, not a mid-chat reply).
- **New:** a "Start a new chat" action on that end state. Because the old
  session is ended, the action returns the visitor to the contact gate and
  the next accepted submission starts a **separate conversation** (new id,
  fresh gate, own one-open-request slot) — the ticket-14 successor flow is
  the precedent, whether implementation reuses `/clear` or drops the session
  and lets the gate's submission create the new conversation.
- **Unchanged:** the request lifecycle on the dashboard — exactly one open
  Email/Phone request per conversation, the red Contact Me tier, the once
  alert/sound, and completion only via **Mark contacted** (or Take over for
  Chat requests). The request is NOT completed, closed, or auto-marked by
  the visitor's session ending.
- **Untouched by explicit requirement:** the live Chat handoff flow —
  "Yes, chat with staff" and the unknown-question one-click path keep their
  waiting → Take over semantics (ticket 103 owns their UI).

## Concerns to address in the design

- **Migration/compatibility:** no schema change required — the request,
  transcript, and visitor-session tables already carry everything. In-flight
  conversations that already have an open Email/Phone request and a live
  visitor session from before deployment: decide whether the session ends on
  their next poll/read (server-driven) or stays until their next request
  (compatibility-tolerant; the acceptance criteria should pin which).
  Existing conversations must not be force-closed by migration.
- **Authorization:** Mark contacted stays gated to the dashboard roles that
  have desk access today (`STAFF_ROLES` — which ticket 102 renames to
  Admin + Admissions Advisor). The visitor-facing end flow adds no new
  authorization surface: session end is server-verified from the visitor's
  own credential, and "Start a new chat" must not accept a live old
  credential.
- **Data retention:** ending the session must not purge anything — the
  conversation, transcript, contact details, and request rows follow the
  existing retention and deletion lifecycle (purge paths already remove
  contact requests with their conversation). The visitor's stored session is
  revoked/expired, not the conversation. A "Start a new chat" successor, if
  created via `/clear`, must keep the old transcript in staff History
  exactly as ticket 14 guarantees; if created by fresh submission, no
  successor linkage exists — record which mechanism is chosen.
- **Desk visibility gap this ticket exposes:** the Mark contacted button
  renders only while the conversation sits in the Active view
  (`selectedActive`). Active means quiet-for-less-than-24h — so a request
  left unmarked for a day rolls to History where no Mark contacted control
  exists, while the boss requirement says the request stays open **until an
  advisor marks it contacted**. Either the button must appear in History
  too, or conversations with an open Email/Phone request must stay in Active
  (a change to `isConversationActive`/desk filtering), or the owner accepts
  the 24h roll. Recorded as decision 3 — do not guess.
- **Terminology:** confirmation copy says "our team" today and the desk chip
  says "Contact Me" — ticket 102's sweep decides whether visitor copy says
  "Admissions Advisor" here; keep this ticket's wording consistent with
  whatever 102 confirms.

## Unresolved product decisions (recorded, not guessed)

1. **Mechanism of "end the visitor's chat session":** revoke the visitor
   session while the conversation stays live server-side (my reading of
   "session"), or close the conversation outright. Closing would remove it
   from the Active desk lists and strand the open request's Mark contacted
   control — if the owner means close, the desk rules need a carve-out for
   open requests. Default in the acceptance criteria: session end, endpoint
   mechanism per implementation.
2. **Post-request bot silence:** today the bot keeps answering after an
   Email/Phone request; ending the session stops that implicitly. Confirm
   the visitor sees no further bot activity in the ended chat (and the desk
   still sees the full transcript).
3. **The 24h Activity roll vs. "open until an advisor marks it contacted":**
   pick one — Mark contacted available from History rows; open-request
   conversations pinned in Active; or the owner accepts that a day-old
   unmarked request is only closable from wherever the control lands.
4. **End-screen composition:** does the visitor see the transcript + the
   confirmation as the final view with "Start a new chat" beneath it, or a
   purpose-built end card (confirmation text + action only)? Any "chat has
   ended" heading wording is an owner call.
5. **Reopen behavior:** if the visitor closes the widget and reopens it
   after the session ended, they should land on the contact gate (a fresh
   chat), not the dead transcript — confirm this is desired for the same
   browser tab.

## Acceptance criteria (once decisions land)

- [ ] Choosing Email or Phone creates the request exactly as today (one open
      request, promotion, one alert/sound) and then ends the visitor's
      session: further visitor posts to that conversation are refused with a
      stable error, and the widget shows the ended-chat state.
- [ ] The visitor sees confirmation of the selected contact method — the
      existing masked-destination, support-hours-aware message — as the last
      visible transcript content of the ended chat.
- [ ] The ended-chat state offers a "Start a new chat" action; activating it
      starts a new conversation with a distinct id via the contact gate, and
      nothing from the old chat (transcript, session, open request) carries
      into it. The old conversation remains intact for staff.
- [ ] The dashboard keeps the Email/Phone request open: red Contact Me
      status, once-per-request alert/sound, and Mark contacted behavior are
      unchanged; marking it contacted completes the request per today's
      rules and adds no transcript row.
- [ ] The desk presents the request per decision 3's resolution, and an
      advisor can always complete an open request somewhere in the dashboard.
- [ ] The Chat handoff path is behaviorally unchanged: Yes/one-click still
      escalates to waiting, alerts, and completes via Take over; ticket 103's
      UI changes are its scope, not this ticket's.
- [ ] Sessions ended server-side cannot be reused: the stored credential
      fails authorization, the widget never dead-ends (gate or end state is
      reachable), and a pre-existing open-request conversation behaves per
      the compatibility decision.
- [ ] Retention and deletion paths (retention sweep, manual History delete,
      Clear history) still remove ended conversations, their transcripts,
      contact details, and request rows as today.
- [ ] Tests cover both dialects: the email path, the phone path, the ended
      state's refusal of posts, Start-a-new-chat's separate conversation,
      desk persistence until Mark contacted, the Chat path's regression
      guard, and retention purge of an ended conversation.

## Comments

2026-11-22: Filed from boss feedback relayed by the owner. Overlap review:
ticket 69 owns the request mechanics this ticket re-outcomes (its recorded
decisions "leaves the conversation bot-active" and "Completion … without …
closing the chat" are superseded for Email/Phone only — ticket 69's Chat-path
decisions stand); ticket 14/66 own the fresh-chat/gate mechanics the new
"Start a new chat" action rides; ticket 103 owns the Chat handoff UI and is
explicitly out of this ticket's scope per the feedback; ticket 102 owns who
"advisor" means. No existing ticket covers ending the session or the new
action. Numbered 104, third of the set (102/103 share the copy sweep; the
docs-PR branch owns 101). Status `needs-info`: decisions 1–5 change the desk
rules, the end screen, and the compatibility story — all owner calls.
