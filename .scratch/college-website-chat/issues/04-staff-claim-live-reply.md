# 04: Staff claim and live reply

**What to build:** A staff member can claim an escalated conversation and reply to the visitor in the same widget. Both sides see the persisted history, even after a temporary connection loss, and staff can close a resolved conversation.

**Blocked by:** 02: Unknown question reaches the shared inbox.

**Status:** ready-for-agent

- [ ] Claiming is atomic: when two staff members try at once, only one becomes the owner and the other sees the current assignment.
- [ ] The claiming staff member can reply, and the visitor sees the message promptly in the same chat.
- [ ] Authorized polling delivers new messages promptly; a visitor or unrelated staff session cannot fetch another conversation's messages.
- [ ] After reload or reconnect, both sides recover missed messages from the stored conversation.
- [ ] Staff can close a resolved conversation; a later visitor question begins a new conversation rather than reopening the closed one.
- [ ] Automated API flows cover claim contention, reply, reconnect, authorization, and closure; a browser check demonstrates the live exchange.
