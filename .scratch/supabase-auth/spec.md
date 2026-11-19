# Supabase Auth implementation spec

Status: implemented locally; hosted verification pending

Approved direction: replace Better Auth with Supabase Auth using owner-managed usernames and passwords. Sign-in is single-stage username+password for every role — the mandatory TOTP requirement is gone (ticket 82; ADR-0006 records the posture change, with ticket 81's login log, suspicious flagging, and IP block as the compensating controls). Public signup, invitation email, password-recovery email, SMTP, Resend, and chat-alert email are not used. Localhost and the Vercel test deployment share a dedicated hosted test project. Production launch remains excluded.

## Interfaces and behavior

- `staff_members` owns the public username, name, role, disabled state, and unique Supabase user link. Existing application staff IDs remain text. The legacy non-null email field contains an internal synthetic identifier and is not displayed or used for delivery.
- POST `/api/auth/sign-in/username` accepts `{username,password}` and is the whole sign-in flow — no enrollment page, no challenge stage. Every protected request verifies a current Supabase session, its backing session row, and the linked active staff record; no second-factor state is consulted (ticket 82).
- Owners create staff/editor accounts with `{name,username,password,role}`. Usernames are unique case-insensitively and match `[a-z0-9._-]{3,32}`; passwords retain the 10-character minimum.
- An owner-issued password reset revokes every session (ADR-0006 carries that clause forward). Staff may change their own password from Settings with only a live session, and a self-service change revokes no sessions (ticket 82 review amendment). No MFA exists anywhere, so no MFA reset exists. Lost-owner recovery uses the trusted CLI after operator identity verification.
- Visitor credentials remain independent of Supabase Auth. Chat escalation raises the existing dashboard attention/sound signal and creates no mail or notification-delivery record.
- Application data remains behind Next.js APIs and direct Postgres. Supabase Data API is disabled and roles never come from user metadata.

## Data transfer and environments

Configuration export/import includes ordered answer rules, publication state, settings, handoff phrases/options, and branding, with obsolete staff attribution cleared. It excludes staff/Auth identities, sessions, conversations, contacts, audit/history, notifications, analytics, and rate limits. Import refuses a used target and leaves the source untouched.

Required configuration is the matching project URL, publishable key, server-only secret key, transaction-pooler database URL, and exact app origin. Localhost and Vercel callback origins are explicit; arbitrary redirects are not accepted.

## Verification

Local isolated tests use the provider substitute and cover account creation, wrong passwords, single-stage sign-in with no second factor, refresh/reload, every role, unprovisioned users, forged/cross-origin requests, immediate disablement, owner-issued password reset with full session revocation, self-service password change without revocation, session revocation, configuration transfer, and sound-only escalation. Hosted verification must repeat the staff and visitor flows with disposable records and clean up only IDs created by that run. No hosted acceptance claim is made until those checks are recorded.
