# 103: Admissions Advisor handoff chat UI

**Status:** ready-for-agent
**Category:** enhancement (visitor widget UX)
**Priority:** P1
**Source:** Boss feedback relayed by the owner, 2026-11-22 (feature area 2 of 3)
**Related:** [43: Lock visitor input while waiting](43-lock-visitor-input-while-waiting-for-human.md) (superseded in part by this ticket), [25: Announce handoff states](25-announce-handoff-states.md) (a11y contract to preserve), [38: Compact handoff state](38-compact-handoff-state-transcript-dominant.md), [67: Click-to-handoff options](67-clickable-suggestions-that-request-staff-handoff.md), [18: Two-row scrollable suggestions](18-two-row-scrollable-suggested-questions.md), [69: Contact request flow](69-confirm-escalation-and-offer-contact-channel.md), [102: Role rename](102-admin-and-admissions-advisor-roles.md) (terminology parent), [41: Welcome message](41-welcome-message-on-chat-open.md) (the configurability pattern decision 5 adopts)

## Requirements from the feedback (verbatim, preserved)

- Stack the three handoff choices vertically so they are not cut off.
- Show "Admissions Advisor will reply" as small, centered text inside the
  transcript instead of a banner.
- Show the advisor-joined notice the same way.
- Allow visitors to continue messaging while an advisor is joining.
- Pause chatbot replies while waiting for an advisor.
- Hide Admissions and Fees prompts once handoff begins.
- Label advisor messages "Admissions Advisor."
- Label bot messages "Admissions Chatbot."

## Current implementation (inspected 2026-11-22)

All widget surfaces live in `src/app/widget/frame/page.tsx` +
`frame.module.css` + the hooks under `frame/hooks/`.

- **Banners, not transcript lines:** the awaiting notice is a red-tinted
  paragraph *above* the transcript — "College staff will reply in this chat.
  Automated answers are paused." (`page.tsx:411-422`, `.handoff` style block
  at `frame.module.css:316`) — and the claimed notice is a second banner —
  "A college staff member has joined the conversation and will reply here."
  (`page.tsx:423-432`). Both carry `role="status"` per ticket 25's
  one-announcer-per-event contract (the transcript `<ol>` is itself
  `aria-live="polite"`).
- **Composer lock while waiting:** `composerLocked = handoff && !claimed`
  (`page.tsx:165`) disables the textarea, Send, topic chips, fresh
  suggestions, and transcript choice buttons (`:341, :457, :509, :625, :637`)
  and renders the "Waiting for a staff member to take over…" line
  (`:498-503`). Server-side, the messages route rejects visitor posts while
  `awaiting_staff` with the stable 409 `awaiting_staff`
  (`api/v1/conversations/[id]/messages/route.ts:297-299` choice branch,
  `:397-399` handoff-option branch, `:468-470` typed path; `awaitingStaffResponse`
  at `:228-233`). `useConversationStream.ts:389-400` handles that 409 by
  handing the words back to the composer. This is ticket 43's implemented
  behavior — requirement 4 reverses it (see Supersessions).
- **Bot replies already pause while waiting:** `recordVisitorChoice`
  (`messages/route.ts:169-205`) records the visitor's words but returns
  `reply: null` whenever the state is not `bot_active` — the claimed-path
  behavior — so once the `awaiting_staff` 409s are removed, visitor messages
  will record and queue for staff with no bot answer. Requirement 5 is
  therefore already satisfied server-side; the ticket must pin it, not
  rebuild it.
- **The three handoff choices:** `DEFAULT_HANDOFF_OPTIONS`
  (`src/settings.ts:98-102`) configures exactly three click-to-handoff
  options ("I want to speak to someone in admissions", "I have a question
  about course prices", "I have a question about financial aid"). On the
  fresh chat they render stacked in `.freshSuggestions` (flex column,
  `page.tsx:465-484`); after bot answers they render in the horizontal
  two-row scrollable rail (`.topics`, `page.tsx:513-531`, ticket 18) where
  each chip is capped at `max-width: 240px` with a two-line
  `-webkit-line-clamp` (`frame.module.css` `.topicButton`/`.topicLabel`) —
  long labels are visibly cut off there.
- **Admissions and Fees prompts:** published answer-rule topics render as the
  suggested-question chips; the seeded rules are "Admissions" and "Fees"
  (`src/store/seed.ts:12, :30`). During a handoff the chips currently stay
  visible but disabled (the `disabled={sending || composerLocked}`
  bindings); the click-to-handoff options rail already hides while `handoff`
  is true (`handoffOptionsVisible`, `page.tsx:185-191`).
- **Sender labels:** transcript bubbles carry no sender name today — role
  classes style them, and only the dashboard shows labels
  (`roleLabel()`, `src/domain/inbox.ts:5-9`: Visitor/Bot/Staff).
- **The copy this ticket rewords** is also in ticket 102's terminology sweep
  ("College staff will reply…", "A college staff member has joined…") — the
  new wording "Admissions Advisor will reply" is given by the boss; the
  joined-notice wording is not.

## Supersessions to record

- **Ticket 43 (lock visitor input while waiting) is reversed by requirement
  4**: the composer, chips, and API no longer lock during `awaiting_staff`;
  the "Waiting for a staff member to take over…" line goes away with the
  lock (its message is replaced by the in-transcript advisor notice). The
  stable 409 `awaiting_staff` disappears from the messages route.
  `tests/awaiting-lock.test.ts` and the suites that pin the lock
  (`escalation-flow`, `handoff-options`, `embed-smoke`) get reworked, not
  deleted: the API must still refuse *choice* posts with stale prompts while
  waiting (that is prompt-staleness, not input lock).
- **Ticket 38's compact-handoff posture** (transcript-dominant, compact
  notices) and **ticket 25's announcement contract** must survive the move
  inside the transcript: the awaiting notice and the joined notice each
  announce exactly once, whether they ride the log's live region or keep
  their own `role="status"`.
- Ticket 67's click-to-handoff semantics and ticket 18's suggestion rail
  elsewhere remain untouched.

## Product decisions

All five resolved by the owner in the 2026-11-24 decision session —
details in the dated Comments entries and in each item below.

1. **What "the three handoff choices" refers to.**
   **RESOLVED 2026-11-24 — option A: the configured click-to-handoff
   options.** The three `DEFAULT_HANDOFF_OPTIONS` ("I want to speak to
   someone in admissions", "I have a question about course prices", "I have
   a question about financial aid") render as a vertical stack with full
   text visible wherever they appear; the post-answer horizontal rail no
   longer carries them. The ticket-69 prompt choices (Yes/No, Email/Phone)
   keep their existing in-bubble layout.
2. **Joined-notice wording.**
   **RESOLVED 2026-11-24 — keep today's sentence verbatim:** "A college
   staff member has joined the conversation and will reply here." The
   owner chose the verbatim keep after being shown the conflict with the
   boss's "replace College Staff references" requirement and ticket 102's
   wording sweep; this string is an explicit, owner-confirmed exception to
   that sweep (ticket 102's Comments carry the amendment). Only its
   presentation changes (small, centered, in-transcript).
3. **Sender-label scope.**
   **RESOLVED 2026-11-24 — option A, with the advisor label reworded by the
   owner:** in the visitor's chat transcript, advisor messages are labeled
   **"Staff"** — an explicit owner override of the feedback's quoted string
   'Label advisor messages "Admissions Advisor."' — and bot messages are
   labeled **"Admissions Chatbot"** (the feedback's other label, untouched).
   Visitor messages stay unlabeled, and the dashboard's transcript labels
   are out of this ticket's scope (ticket 102's sweep owns them). The
   "Staff" label is the second exception to ticket 102's no-visible-"Staff"
   sweep rule, recorded there as amendment 2.
4. **Topic hiding edge:** once handoff begins and the Admissions/Fees chips
   hide, the topicless-widget intro line "Ask us your question."
   (`page.tsx:405-410`) becomes the only guidance — should it stay, or is
   the in-transcript advisor notice enough?
   **RESOLVED 2026-11-24 — option A + the waiting-notice string:** the
   intro line stays hidden during handoff (the in-transcript notice and
   the open composer are the guidance), and the waiting notice reads
   **"Staff will reply"** — the owner overrode the feedback's quoted
   "Admissions Advisor will reply" with the standing rule: **"Admissions
   Advisor is only internal."** Visitor-facing human references say
   "Staff"; the "Admissions Advisor" vocabulary appears only in
   dashboard-facing copy (ticket 102's sweep is re-scoped accordingly,
   its amendment 3).
5. **Waiting-state messaging:** with messaging open, what (if anything)
   replaces the old waiting line as the visual companion to the in-transcript
   notice (e.g. nothing, or a subtle "Advisors can see your new messages"
   hint)?
   **RESOLVED 2026-11-24 — option D: the waiting notice becomes
   configurable, welcome-message style.** Nothing replaces the old waiting
   line (deleted with the lock); the in-transcript notice is the sole
   waiting indicator, and its wording becomes a staff-published setting
   with the built-in default **"Staff will reply"** — following ticket 41's
   welcome-message pattern: a seeded settings row, a staff settings API
   gated like the welcome setting's, a form in the Answers area, and the
   widget rendering the published value. Unset or empty falls back to the
   default. The joined notice stays the hardcoded sentence of decision 2 —
   configurability was chosen for the waiting notice only.

## Acceptance criteria

- [ ] The three handoff choices — the configured click-to-handoff options
      (`DEFAULT_HANDOFF_OPTIONS`: "I want to speak to someone in
      admissions", "I have a question about course prices", "I have a
      question about financial aid") — render as a vertically stacked list
      with their full text visible (no clipping, no horizontal scrolling, no
      two-line clamp) in every state where they appear: the fresh-chat
      stack and after bot answers (no longer the horizontal rail). The
      layout holds at the widget's minimum configured width (ticket 71) and
      on touch sizes (ticket 27). The ticket-69 prompt choices (Yes/No,
      Email/Phone) keep their existing in-bubble layout, and the
      suggested-question chips keep their horizontal rail.
- [ ] The awaiting state shows the waiting notice as small, centered text
      inside the transcript area — not a banner block above it — and the
      transcript remains the visually dominant surface (ticket 38). The
      notice's wording is a configurable setting with the built-in default
      "Staff will reply" (the owner overrode the feedback's "Admissions
      Advisor will reply": "Admissions Advisor is only internal"); unset or
      empty falls back to that default.
- [ ] The waiting notice is configurable per the welcome-message pattern
      (ticket 41): a seeded settings row, a staff settings API and an
      Answers-area form gated to the roles that edit the welcome message
      (Admin and Admissions Advisor after ticket 102), and the widget
      renders the published value without requiring visitor
      authentication. The old waiting line is deleted; the notice is the
      sole waiting indicator.
- [ ] The advisor-joined notice uses the same small, centered in-transcript
      treatment, keeping today's exact sentence — "A college staff member
      has joined the conversation and will reply here." — unchanged (the
      owner-confirmed exception to ticket 102's wording sweep; presentation
      alone moves).
- [ ] Each notice is announced to screen readers exactly once per state
      event (ticket 25's contract), with no double announcement from the
      log's live region and the notice's own semantics.
- [ ] While an advisor is joining (`awaiting_staff`), the visitor can type
      and send messages: the composer stays enabled, the API records the
      messages (no `awaiting_staff` 409), and the messages appear in the
      transcript and on the desk for the claiming advisor.
- [ ] Chatbot replies stay paused while waiting: a visitor message during
      `awaiting_staff` produces no bot answer and no answer-rule match, and
      the bot resumes only per the existing claim/close semantics.
- [ ] Once handoff begins, the Admissions and Fees topic chips (and every
      other suggested-question chip) are hidden, not merely disabled, in the
      fresh-suggestion stack and the ongoing rail; stale persisted prompt
      choices in the transcript still refuse gracefully server-side. The
      topicless intro line "Ask us your question." does not appear during
      handoff states.
- [ ] In the visitor's chat transcript, advisor messages render labeled
      "Staff" (the owner's override of the feedback's "Admissions Advisor"
      label — ticket 102's sweep exception 2) and bot messages render
      labeled "Admissions Chatbot"; visitor messages carry no label. The
      dashboard's transcript labels are unchanged by this ticket.
- [ ] The live Chat handoff flow's staff-side behavior is unchanged: Take
      over, reply, release, transfer, alerts, and desk statuses behave as
      today.
- [ ] Suites covering the lock (awaiting-lock), announcements (embed-smoke,
      a11y batch), handoff flow (escalation-flow, handoff-options,
      contact-requests), and widget rendering pass on both dialects after
      their contract updates; the new waiting-notice setting is covered
      too (default fallback, configured value, validation, role gating).

## Comments

2026-11-24: DECISION SESSION (owner). Decision 1 — "the three handoff
choices": **option A, the configured click-to-handoff options.** The owner
confirmed the referent is the three `DEFAULT_HANDOFF_OPTIONS`, not the
ticket-69 prompt choices. AC 1 now names the three options and both render
sites; the prompt choices and the suggested-question rail are explicitly
out of the change.

2026-11-24: DECISION SESSION (owner). Decision 2 — joined-notice wording:
**keep today's sentence verbatim** — "A college staff member has joined the
conversation and will reply here." The owner was shown the two readings
(swap the role word vs. keep the "Staff" word) and the conflict with the
boss's "replace College Staff references" requirement and ticket 102's
confirmed wording sweep, and chose the verbatim keep. Ticket 102 is amended
accordingly: its reworded-strings AC now excepts this one string, so the
tickets stay consistent. The notice's presentation still moves (small,
centered, inside the transcript); the announcement contract (ticket 25)
still applies.

2026-11-24: DECISION SESSION (owner). Decision 3 — sender-label scope:
**option A, reworded by the owner** — "A. but keep it as staff, not
admissions advisor". Scope per A: only advisor and bot messages carry
labels in the visitor's chat; visitor messages stay unlabeled; the
dashboard is out of this ticket's scope. The strings: advisor messages are
labeled "Staff" — a deliberate owner override of the feedback's quoted
'Label advisor messages "Admissions Advisor."' (the owner was shown the
conflict and three readings, and picked the visitor-chat override) — and
bot messages keep the feedback's "Admissions Chatbot". Ticket 102 records
this as its second sweep exception (amendment 2), alongside the
advisor-joined notice. Observed pattern across decisions 2 and 3:
visitor-facing references to the human stay "staff"; the chatbot's own
branding becomes "Admissions Chatbot".

2026-11-24: DECISION SESSION (owner). Decision 4 — intro line and
waiting-notice wording: **option A** for the intro line — "Ask us your
question." stays hidden during handoff; the in-transcript notice plus the
open composer are the guidance. On the waiting-notice flag the owner
answered: **keep it as Staff — "Admissions Advisor is only internal."**
The waiting notice therefore reads "Staff will reply" (owner override of
the feedback's quoted "Admissions Advisor will reply"), and the statement
is recorded as a standing rule in both tickets: visitor-facing human
references say "Staff"; "Admissions Advisor" appears only in
dashboard-facing copy. Ticket 102's sweep AC and census are re-scoped to
that rule (its amendment 3), absorbing its two earlier string exceptions
as instances of the same rule. The bot's "Admissions Chatbot" label is
branding, not a human reference, and stands in the visitor chat.

2026-11-24: DECISION SESSION (owner). Decision 5 — the waiting visual: the
owner first asked whether the waiting line is configurable (it is not —
none of the handoff notices are; the configurable visitor-facing texts are
the Welcome message, answer rules, handoff-option labels, and escalation
phrases). On learning that, they chose **option D: make the waiting notice
configurable**, following the welcome-message precedent. Recorded: nothing
replaces the deleted waiting line; the in-transcript notice is the sole
waiting indicator, its wording a staff-published setting (seeded default
"Staff will reply"; unset/empty falls back to the default), edited through
the Answers area by the roles that own the welcome message. Two boundaries
stated in the session, flagged for objection: (a) the joined notice stays
the hardcoded sentence of decision 2 — configurability applies to the
waiting notice only; (b) an empty saved value falls back to the default
rather than hiding the notice.

2026-11-24: DECISION SESSION COMPLETE for this ticket. All five decisions
resolved (1: the three configured handoff options; 2: joined notice kept
verbatim; 3: labels "Staff"/"Admissions Chatbot", visitors unlabeled;
4: intro line hidden, waiting notice "Staff will reply", standing rule
"Admissions Advisor is only internal"; 5: the waiting notice becomes
configurable, welcome-message style). Status `needs-info` →
**`ready-for-agent`**: the ticket is fully specified with testable ACs.
Ticket 102's confirmed vocabulary and re-scoped sweep feed this ticket's
strings; its standing rule governs every visitor-facing human reference.

2026-11-22: Filed from boss feedback relayed by the owner. Overlap review:
ticket 43's lock is directly superseded (recorded above); ticket 25's
announcement contract carries forward; ticket 69's prompt flow is untouched
by this ticket (ticket 104 owns the Email/Phone outcome); tickets 67/18/38/71
pin the rails and sizes this ticket adjusts. No existing ticket covers the
vertical stacking, the in-transcript notices, the topic hiding, or the sender
labels. Numbered 103 after 102 because the two share visitor-facing copy and
102's confirmed vocabulary feeds this ticket's labels. Status `needs-info`:
decision 1 (what the "three handoff choices" are) changes what gets built,
and decisions 2–5 are wording/scope choices only the owner can make.
