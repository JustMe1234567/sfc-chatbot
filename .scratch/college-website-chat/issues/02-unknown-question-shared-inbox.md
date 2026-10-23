# 02: Unknown question reaches the shared inbox

**What to build:** When a visitor asks a question with no applicable answer rule, the bot immediately raises an escalation. The visitor sees that staff help is needed, and a named staff member signs in with multifactor authentication to see the full conversation in the protected shared inbox.

**Blocked by:** 01: Approved answer in the WordPress widget.

**Status:** resolved


- [x] An unmatched question creates one escalation and places the conversation in the unclaimed shared inbox.
- [x] The visitor sees handoff status, and the bot stops sending automated answers in that conversation.
- [x] The owner is bootstrapped server-side; public staff sign-up is disabled. A provisioned, email-verified named staff member signs in with a password and required TOTP second factor before reading visitor and bot history.
- [x] A maintained auth library stores staff accounts and sessions in SQLite. Staff can sign out, revoke sessions, and complete an expiring single-use password reset; reset and disablement revoke old sessions.
- [x] Dashboard pages and staff API endpoints verify the current server-side session, active account, and role on each request. Staff session cookies are HttpOnly, Secure and SameSite in production, and state-changing actions have CSRF protection.
- [x] Login and reset attempts are rate limited and use generic errors. Auth secrets remain in server environment settings; neither widget nor dashboard client bundles contain them.
- [x] Verification and reset emails are sent server-side through a test mail transport in development; production delivery uses the approved sender introduced in ticket 03.
- [x] Automated flows reject unauthenticated, unverified, second-factor-incomplete, disabled, expired-session, and wrong-role access; reset-token replay fails.
- [x] A visitor credential cannot read another visitor's conversation or staff-only data.
- [x] The escalation and inbox state survive a page reload, and an automated API flow verifies the result.

## Comments

**2026-10-23 — implemented.**

- **Escalation flow:** an unmatched (or ambiguous, until ticket 06 adds choices) question transitions the conversation to `awaiting_staff` exactly once, appends an honest handoff bot message, and pauses all automated answers — later questions in that conversation are stored without bot replies. The visitor frame shows a "College staff will reply in this chat" banner from the conversation state, which reloads with the history.
- **Authentication:** Better Auth 1.7 (`better-auth`) over the same SQLite database via Kysely + `node:sqlite` (migration `0002`): public sign-up disabled, email+password with required verification, mandatory TOTP enrollment (the dashboard forces it on first sign-in, then signs out so the next sign-in exercises the full password+code flow), Better Auth's own login/reset/TOTP rate limits and generic errors, Secure/HttpOnly/SameSite cookies in production, and a hard startup error if `BETTER_AUTH_SECRET` is unset in production.
- **Session lifecycle:** sign-out, "sign out everywhere" (`POST /api/staff/sessions/revoke-all`, same-origin guarded), password reset via the dev mail outbox (single-use token; completing a reset deletes all sessions; replay refused), and owner-side ban through the admin endpoint kills existing sessions immediately.
- **Shared inbox:** `GET /api/staff/conversations` (+ `/[id]` transcripts) and the dashboard pages at `/dashboard/*` all re-verify session, verified email, active account, TOTP enrollment, and role (owner/staff) on every request through one `requireStaff` guard; a visitor bearer token on staff endpoints gets 401.
- **Mail:** verification/reset emails land in the `mail_outbox` table (dev transport); production sender is ticket 03.
- **Tests:** 40 passing (escalation flow 3, staff auth/inbox 15 including the full enroll→TOTP→inbox journey, ban, expiry, sign-out, revoke-all, reset+replay, CSRF guard). Typecheck clean.
- **Interactive browser check:** login → forced TOTP enrollment (secret displayed, code confirmed, auto sign-out) → password+code sign-in → shared inbox listing the escalated conversation → transcript page; visitor widget showed the handoff banner after an unknown question. Two real defects found and fixed during the check: the auth client needed same-origin defaults (was cross-origin `localhost`→`127.0.0.1`), and better-auth needed both loopback origins in `trustedOrigins` during development.

Notes for the human pass:

- An ambiguous question (several rules match) escalates with the same handoff message; ticket 06 replaces that with topic choices.
- `sameOriginGuard` (CSRF for cookie-authenticated mutations) is live on `revoke-all` and will wrap the ticket 04 claim/reply mutations.
- The owner ban/unban flow is exercised through Better Auth's admin API; the dashboard UI for invites/disablement is ticket 08.
- Access-control role vocabulary for answer rules/staff/settings is declared but unused until tickets 05/08.

**2026-10-23 — accepted as complete.** The human pass accepted the implementation, its browser checks, and the recorded judgment calls as they stand. Status set to `resolved`.
