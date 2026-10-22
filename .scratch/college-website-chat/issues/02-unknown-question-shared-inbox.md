# 02: Unknown question reaches the shared inbox

**What to build:** When a visitor asks a question with no applicable answer rule, the bot immediately raises an escalation. The visitor sees that staff help is needed, and a named staff member can sign in and see the full conversation in the shared inbox.

**Blocked by:** 01: Approved answer in the WordPress widget.

**Status:** ready-for-agent

- [ ] An unmatched question creates one escalation and places the conversation in the unclaimed shared inbox.
- [ ] The visitor sees handoff status, and the bot stops sending automated answers in that conversation.
- [ ] A provisioned staff account can sign in and read the visitor and bot history; an unauthenticated user cannot open the inbox.
- [ ] A visitor credential cannot read another visitor's conversation or staff-only data.
- [ ] The escalation and inbox state survive a page reload, and an automated API flow verifies the result.
