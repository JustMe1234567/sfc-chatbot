# 37: Unknown questions offer "chat with a human" first; escalation happens on click

**Status:** ready-for-agent

**Reference screenshot:** [What the visitor sees after requesting a human: handoff notice + email capture](../references/visitor-widget-after-human-request.png).

**What to build:** Today an unknown question escalates **immediately** — bot replies pause, the conversation lands in the shared inbox, and staff get an email, all without the visitor asking. Change the unknown-question flow to be visitor-consented:

- [ ] When no answer rule matches, the bot posts a message along the lines of: "I don't have knowledge of that." with a clickable action: **"Chat with a human"**. Wording stays truthful and does not promise a response time (spec's support-hours rule still applies to the eventual handoff message).
- [ ] No escalation, no staff email, no inbox entry, and no bot-pause happens until the visitor clicks the action. The conversation remains bot-active.
- [ ] Clicking "Chat with a human" runs the existing escalation machinery unchanged: escalation created, bot replies pause, handoff message shown, the visitor sees the handoff + email-capture state (screenshot), one deduplicated staff alert email, conversation appears in the dashboard **Incoming** section with an attention indicator.
- [ ] If the visitor ignores the offer and types another question, it is matched normally. A new unknown re-offers (repeated unknowns must not stack duplicate offer messages in one turn — one offer per unknown message is fine).
- [ ] Configured escalation phrases (ticket 06) still escalate **immediately** without an offer — that behavior is untouched.
- [ ] Ambiguity choices (ticket 06) are untouched: several matches still show their choice buttons exactly as today.
- [ ] The dashboard's waiting indicators (Incoming section, attention chips) need no new mechanism — verify they light up from the click-triggered escalation as they do today.
- [ ] Update the flow tests: `tests/escalation-flow.test.ts` currently asserts unknown → immediate escalation; split it into unknown → offer only, then click → escalation + alert + inbox. Cover: offer does not alert staff, click alerts exactly once, escalation phrase bypasses the offer.
- [ ] Consider the matcher/dashboard wording: staff-facing records should show the visitor explicitly requested a human (the escalation reason "unknown" becomes "requested by visitor after unknown" or similar) — implementer's judgment, keep it small.

## Context

The user wants the bot to admit gaps politely and let the visitor opt into human help, instead of every unrecognized question silently paging staff. The escalation pipeline, alert email, inbox, and attention indicators all exist (tickets 02, 03, 12) and are reused as-is; the only new surface is the offer message + action button in the widget, plus the matcher's unknown branch no longer calling escalation directly. The offer action can reuse the persisted-choice button rendering from ticket 06 (a message with buttons the visitor clicks) with a distinct action type that triggers escalation — implementer's call, as long as the button is keyboard-accessible and announced to screen readers like other transcript messages (see issues 25/29 for the live-region context).

**Spec note:** this amends the spec's Implementation Decision "An unknown question or configured escalation phrase immediately creates an escalation" — after this lands, immediate escalation applies to escalation phrases only; unknown questions escalate on visitor consent. Update that sentence in `.scratch/college-website-chat/spec.md` when implementing (ticket 02's accepted behavior is intentionally evolved, not regressed).

## Comments

2026-11-01: Filed from the user's request: "when there are things not on the answers, it will be prompting 'i don't have knowledge of that, chat with a human' then when a user clicks that it will escalate and notify an admin and on the dashboard there will be indications of a chat waiting for a human agent." Screenshot shows the desired post-click state (handoff notice + email capture), which is today's post-escalation state — reused unchanged. Coordinate with issue 25 (the offer and the click's handoff notice must both be screen-reader announced).

2026-11-01: Implementation decision: the existing persisted-choice UI carries a reserved `request-human` action. The API accepts it only when the latest bot message contains that offer, and the click is recorded in the transcript as the visitor message “Chat with a human,” making the staff-facing reason explicit without adding a new escalation-reason schema.
