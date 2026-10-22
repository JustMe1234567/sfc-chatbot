# 07: Visitor email and secure return

**What to build:** At handoff, a visitor may provide an email address for follow-up. If staff reply after the visitor leaves, the visitor receives a secure link and can resume the same conversation. A visitor who declines email can still use live chat while present.

**Blocked by:** 03: One reliable escalation email; 04: Staff claim and live reply.

**Status:** ready-for-agent

- [ ] Email is requested only at escalation and is optional; declining it keeps live chat available with a clear explanation of the follow-up limit.
- [ ] When staff reply to a visitor who has left and provided email, one visitor notification contains a short-lived, revocable return link and no full transcript.
- [ ] A valid link restores only its own conversation and history; expired, revoked, and other-conversation links cannot read messages.
- [ ] A visitor still on the page receives the staff reply in the widget without an unnecessary return email.
- [ ] Automated API and email flows cover the optional address, return, expiry, access isolation, and notification deduplication.
