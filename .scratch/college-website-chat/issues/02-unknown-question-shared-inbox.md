# 02: Unknown question reaches the shared inbox

**What to build:** When a visitor asks a question with no applicable answer rule, the bot immediately raises an escalation. The visitor sees that staff help is needed, and a named staff member signs in with multifactor authentication to see the full conversation in the protected shared inbox.

**Blocked by:** 01: Approved answer in the WordPress widget.

**Status:** ready-for-agent

- [ ] An unmatched question creates one escalation and places the conversation in the unclaimed shared inbox.
- [ ] The visitor sees handoff status, and the bot stops sending automated answers in that conversation.
- [ ] The owner is bootstrapped server-side; public staff sign-up is disabled. A provisioned, email-verified named staff member signs in with a password and required TOTP second factor before reading visitor and bot history.
- [ ] A maintained auth library stores staff accounts and sessions in SQLite. Staff can sign out, revoke sessions, and complete an expiring single-use password reset; reset and disablement revoke old sessions.
- [ ] Dashboard pages and staff API endpoints verify the current server-side session, active account, and role on each request. Staff session cookies are HttpOnly, Secure and SameSite in production, and state-changing actions have CSRF protection.
- [ ] Login and reset attempts are rate limited and use generic errors. Auth secrets remain in server environment settings; neither widget nor dashboard client bundles contain them.
- [ ] Verification and reset emails are sent server-side through a test mail transport in development; production delivery uses the approved sender introduced in ticket 03.
- [ ] Automated flows reject unauthenticated, unverified, second-factor-incomplete, disabled, expired-session, and wrong-role access; reset-token replay fails.
- [ ] A visitor credential cannot read another visitor's conversation or staff-only data.
- [ ] The escalation and inbox state survive a page reload, and an automated API flow verifies the result.
