# 10: Expire old conversations

**What to build:** The owner can set a transcript retention period. After a closed conversation passes that period, its messages and visitor contact details are removed, and old visitor links can no longer reopen it.

**Blocked by:** 07: Visitor email and secure return.

**Status:** ready-for-agent

- [ ] An owner can configure the retention period and see the current value in the dashboard.
- [ ] An automated cleanup removes closed conversations, messages, and visitor email addresses after the configured period.
- [ ] Active conversations are preserved until closed, and a deleted conversation is unavailable through the dashboard, widget session, and return link.
- [ ] Cleanup is safe to rerun and records a minimal, non-transcript audit result for operators.
- [ ] Automated tests cover the retention boundary, active conversation preservation, repeated cleanup, and revoked access.
