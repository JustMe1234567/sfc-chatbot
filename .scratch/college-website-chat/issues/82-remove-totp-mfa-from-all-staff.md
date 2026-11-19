# 82: Remove TOTP/MFA from every staff account

Status: ready-for-human
Blocked by: 81 (landed — dac9be8d8)

## What to build

Take two-factor authentication out of the staff stack entirely — every account, including owners — leaving ticket 81's login logging, suspicious flagging, and IP block as the compensating controls. Password checks stay hosted in Supabase Auth; only the second factor goes.

- **Provider** (`src/auth/supabase-provider.ts`): remove the `twoFactorRedirect` sign-in gate, `two-factor/enable`, `two-factor/verify-totp` (and its staff-row enrollment write), and `resetMfa`; `change-password` drops its aal2 requirement; sign-in no longer reports factors; `AuthIdentity` loses its `aal2`/`mfaEnrolled` surface as the implementation allows.
- **Session checks** (`src/api/staff.ts`): `requireStaff` stops demanding aal2 and an enrolled factor; the `two_factor_enrollment_required` / `two_factor_challenge_required` error codes go. Existing sessions keep working across the deploy (aal1 tokens are already valid).
- **UI**: the login page becomes single-stage username+password; the mandatory `/dashboard/enroll` page is deleted; the staff roster loses its second-factor display; "Reset authenticator" leaves `credential-actions.tsx`; `auth-client.ts` drops its twoFactor block.
- **Transfer eligibility**: the `twoFactorEnabled` filter goes (`conversation-desk.tsx`, `activeInboxMember` in `src/api/staffMembers.ts`) — every active staff member is transfer-eligible; the owner-only reassignment check is untouched.
- **Provisioning** (`src/auth/provision.ts`, `scripts/bootstrap-owner.ts`): stop writing the factor columns; bootstrap's "then enrolls an authenticator" line becomes plain password sign-in.
- **Columns**: new migrations drop `staff_members."twoFactorEnabled"` and `"mfaRecoveryApprovedAt"` in both dialects. The legacy better-auth `twoFactor`/`session`/`account`/`verification` tables stay untouched (settled: separate housekeeping).
- **Enrolled factors**: verified TOTP factors (including the owner's real one in prod) are removed so nothing is left half-enrolled — via the admin API or the auth-schema SQL seam the provider already uses; on prod this is a one-time cleanup run against the deployed store.
- **Test fake**: `tests/fake-auth-provider.ts` loses its TOTP machinery; login fixtures simplify accordingly.

## Acceptance criteria

- Sign-in is single-stage username+password for every account; no enroll page exists anywhere; a fresh account reaches the dashboard with password alone.
- `requireStaff` accepts sessions with no aal2/factor check; pre-change sessions keep working across the deploy.
- Every active staff member is transfer-eligible regardless of factor state; the owner-only reassignment restriction is untouched.
- The `reset-mfa` route, roster factor display, and Reset-authenticator UI are gone; password reset still revokes every session.
- Both dialects' migrations drop the two columns; the legacy better-auth tables are untouched.
- After the cleanup step, no verified TOTP factor remains (cert/scratch: none enrolled; prod: the owner's factor removed by the one-time run).
- Tests updated for the fake provider, `requireStaff`, transfer eligibility, and provisioning; a cert script screenshots the single-stage login and the staff page without the factor column (owner-UI cert runs need the hosted test project substrate per ticket 80).
- `docs/adr/0006` records the posture change — mandatory TOTP replaced by detection (ticket 81's log/flag/block), what was given up, and why — explicitly superseding ADR-0004's mandatory-TOTP clause.
- `GLOSSARY.md` rewrites land with this ticket's commit: **Staff account** drops the authenticator-enrollment clause, **Staff credential reset** becomes password-only, **Authenticator recovery** is removed.

## Comments

2026-11-19: Filed alongside ticket 81 from the user's request ("remove the mfa on every accounts or users"), sharpened through grill-with-docs. Settled decisions: total removal including owners (trade-off stated once — logs detect after the fact, TOTP prevents; the user chose visibility over prevention); full cleanup (factors deleted, columns dropped, reset surface gone); transfer eligibility becomes unconditional; legacy dead tables out of scope. Human step, not code: the owner deletes the Springfield entry from their authenticator app. Owners beyond the first keep coming from `bootstrap-owner` runs (`--username/--password/--name`, `DATABASE_URL` pointed at the deployed store) — "up to 3 owners" needs no new code; the user confirmed the ability is enough and no cap is enforced.

2026-11-19: IMPLEMENTED. Provider single-stage (`sign-in/username` answers `{success:true}`, no factor listing; `get-session` sheds `twoFactorEnabled`/`aal`; `two-factor/*` routes and `resetMfa` deleted; `change-password` needs only a live session); `AuthIdentity` loses `aal`/`mfaEnrolled`; `requireStaff` drops both factor checks and their error codes (existing aal1 sessions stay valid — nothing forces a re-sign-in); login page single-stage; `/dashboard/enroll` deleted; `reset-mfa` route deleted; roster factor line and Reset-authenticator control gone; `account-form` hint password-only; transfer eligibility unconditional in `activeInboxMember` + desk filter (owner-only reassignment untouched); provision INSERT and test-fake provisioning shed the column; `recover-staff-credentials` loses `--reset-mfa` (password mode only); migrations `0022`/`postgres-0012` drop `twoFactorEnabled` + `mfaRecoveryApprovedAt` (README mapping row added, plus the missing ticket-81 row found while verifying); `scripts/remove-enrolled-factors.ts` is the one-time prod cleanup (admin-API sweep, idempotent, sessions untouched); ADR-0006 supersedes ADR-0004's mandatory-TOTP clause (0004's status line notes it); GLOSSARY: Staff account + Staff credential reset rewritten, Authenticator recovery removed. `staff_mfa_reset` stays in the audit enum and desk label so historical rows still render. Suites green: SQLite 564/0, Postgres 566/0.

Notes for human review: (1) `scripts/cert82-totp-removal.mjs` written but NOT RUN — owner-UI cert runs stay gated by ticket 80's substrate decision, same contract as cert81. (2) The prod factor cleanup (`npx tsx scripts/remove-enrolled-factors.ts`) runs once after the redeploy, against the deployed project's env — documented in deployment.md §4. (3) KNOWN STALE, needs a decision: ~15 standalone shot/cert scripts hand-roll the old enroll+TOTP flow inline instead of using shot-driver (answers-shots, answers-lifecycle-shots, sidebar-shots, sidebar-callouts-shots, desk-status-shots, history-delete-shots, history-retention-shots, visitor-emails-shots, cert28, cert29, cert66, cert67, cert70, cert74, cert75, cert79). None is imported by tests or the build; they are manual-run tools for closed tickets. Left untouched per scope discipline (ticket 80's fleet port was its own ticket) — file a housekeeping ticket to port them to shot-driver's `signIn`, or bless them as frozen artifacts. The four scripts that DO go through shot-driver (analytics-shots, design-shots, motion-shots, cert81) were ported here.
