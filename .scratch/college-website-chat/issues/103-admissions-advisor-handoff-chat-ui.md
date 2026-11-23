# 103: Admissions Advisor handoff chat UI

**Status:** needs-info
**Category:** enhancement (visitor widget UX)
**Priority:** P1
**Source:** Boss feedback relayed by the owner, 2026-11-22 (feature area 2 of 3)
**Related:** [43: Lock visitor input while waiting](43-lock-visitor-input-while-waiting-for-human.md) (superseded in part by this ticket), [25: Announce handoff states](25-announce-handoff-states.md) (a11y contract to preserve), [38: Compact handoff state](38-compact-handoff-state-transcript-dominant.md), [67: Click-to-handoff options](67-clickable-suggestions-that-request-staff-handoff.md), [18: Two-row scrollable suggestions](18-two-row-scrollable-suggested-questions.md), [69: Contact request flow](69-confirm-escalation-and-offer-contact-channel.md), [102: Role rename](102-admin-and-admissions-advisor-roles.md) (terminology parent)

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

## Unresolved product decisions (recorded, not guessed)

1. **What "the three handoff choices" refers to.** Primary interpretation
   from the code: the three configured click-to-handoff options
   (`DEFAULT_HANDOFF_OPTIONS`), which are cut off in the post-answer
   horizontal rail; the fix renders them (wherever they appear) as a vertical
   stack with full text visible, no two-line clamp. Alternative reading: the
   Chat/Email/Phone confirmation choices inside the transcript bubble
   (ticket 69's two-step prompt renders 2 choices at a time, never 3, which
   is why the primary reading is preferred). Needs the owner's confirmation
   before layout work starts.
2. **Joined-notice wording.** The boss fixed "Admissions Advisor will reply"
   for the waiting notice but not the joined notice. Proposed: "An Admissions
   Advisor has joined the chat." — confirm.
3. **Sender-label scope.** Do visitor messages also get a label (e.g.
   "Visitor" or the visitor's name), and do the dashboard transcript labels
   change here (Bot → "Admissions Chatbot", Staff → "Admissions Advisor")
   or stay with ticket 102's sweep?
4. **Topic hiding edge:** once handoff begins and the Admissions/Fees chips
   hide, the topicless-widget intro line "Ask us your question."
   (`page.tsx:405-410`) becomes the only guidance — should it stay, or is
   the in-transcript advisor notice enough?
5. **Waiting-state messaging:** with messaging open, what (if anything)
   replaces the old waiting line as the visual companion to the in-transcript
   notice (e.g. nothing, or a subtle "Advisors can see your new messages"
   hint)?

## Acceptance criteria (once decisions land)

- [ ] The three handoff choices render as a vertically stacked list with
      their full text visible (no clipping, no horizontal scrolling, no
      two-line clamp) in every state where they appear; the layout holds at
      the widget's minimum configured width (ticket 71) and on touch sizes
      (ticket 27).
- [ ] The awaiting state shows "Admissions Advisor will reply" as small,
      centered text inside the transcript area — not a banner block above it
      — and the transcript remains the visually dominant surface (ticket 38).
- [ ] The advisor-joined notice uses the same small, centered in-transcript
      treatment with the confirmed wording.
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
      choices in the transcript still refuse gracefully server-side.
- [ ] Advisor messages render labeled "Admissions Advisor" and bot messages
      render labeled "Admissions Chatbot" per the confirmed label scope.
- [ ] The live Chat handoff flow's staff-side behavior is unchanged: Take
      over, reply, release, transfer, alerts, and desk statuses behave as
      today.
- [ ] Suites covering the lock (awaiting-lock), announcements (embed-smoke,
      a11y batch), handoff flow (escalation-flow, handoff-options,
      contact-requests), and widget rendering pass on both dialects after
      their contract updates.

## Comments

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
