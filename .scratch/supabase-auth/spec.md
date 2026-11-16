# Hosted Supabase staff authentication

Status: needs-info

Approved 2026-11-14: replace Better Auth with Supabase Auth; staff-only email/password, invitation-only, mandatory TOTP for owner/staff/editor. Preserve current permissions, immediate disabling, reset/global logout revocation, and visitor credentials. Localhost and Vercel test deployment use a dedicated hosted test project. Production launch is excluded. Source database remains intact: transfer only answer rules, settings (including handoff options/phrases), and branding into a fresh target; no identities, conversations, contacts, audit, analytics, notification, session, or rate-limit records.

## Delivery graph

1. Core: provider boundary, staff schema, config validation, SSR cookies, trusted authorization, invitations, revocation, bootstrap.
2. UI (depends on core interface): existing styled login/enroll, invitation/recovery, MFA and logout; owner invitation status instead of passwords.
3. Configuration transfer (independent): read-only export, fresh-target import, validation and tests, preserve source.
4. Tests/docs/integration (depends on core interface; final checks depend on all): test-only provider, adapt existing authorization tests, docs/ADR, hosted verification.

## Shared interfaces for implementers

- `src/auth/provider.ts`: AuthIdentity has `userId` (Supabase user ID), `sessionId`, `email`, `emailVerified`, `aal: 'aal1'|'aal2'`, `mfaEnrolled`. AuthProvider has `authenticate(headers)`, `handle(request)`, `invite(email, name): Promise<{ userId: string }>`, `revokeAll(userId)`, `disable(userId)`. Live and test providers implement this boundary. Test adapter is installed from Vitest setup only, never selected via environment configuration in a running app.
- `ChatbotService.auth` becomes AuthProvider. `src/auth/server.ts` retains role constants/types but no Better Auth.
- Application staff table `staff_members` keeps current camelCase fields (`id`, `name`, `email`, `role`, `banned`, `emailVerified`, `twoFactorEnabled`, `createdAt`, `updatedAt`) plus nullable unique `supabaseUserId` and `invitationStatus` ('pending'|'sent'|'accepted'). New IDs are UUID strings; existing application staff references remain text.
- Auth HTTP endpoints: POST `/api/auth/sign-in/email` {email,password} -> {twoFactorRedirect:boolean}; GET `/api/auth/get-session` -> {user:{id,email,name,twoFactorEnabled},aal}|null; POST `/api/auth/two-factor/enable` -> {totpURI,qrCode,factorId}; POST `/api/auth/two-factor/verify-totp` {code,factorId?} -> success; POST `/api/auth/sign-out` ends current session; POST `/api/auth/forget-password` {email} -> generic success; POST `/api/auth/reset-password` {newPassword} -> success then sign-in; POST `/api/auth/set-password` {newPassword} for invitation. Minimum 10 chars. GET `/api/auth/confirm?token_hash=...&type=invite|recovery` verifies OTP and redirects ONLY to fixed `/dashboard/accept-invitation` or `/dashboard/reset-password`. Password recovery must require enrolled MFA before password change. All unsafe app endpoints enforce existing same-origin guard; all auth responses private/no-store.
- Browser auth client can be a fetch facade in existing `src/lib/auth-client.ts`; server handles Supabase SSR cookies. Keep endpoint responses explicit; no Better Auth packages in runtime.
- Existing owner POST `/api/staff/members` input stays {name,email,role}; output {member,invitationStatus:'sent'}, no initialPassword. Same email with pending invite is retried, but cannot change role or name or reactivate disabled/accepted accounts.
- Configuration transfer must use direct source read-only connection, never `getChatbotService` or migrating/openDatabase helpers on source. Do not edit package.json in subagents; report needed scripts to root.

## Verification

Provider and staff API seams test all roles, invalid/stale/unverified/aal1 identities, immediate disable/reset/logout, invite retries, recovery MFA, cookie handling and CSRF. Preserve SQLite/Postgres application coverage with a test-only provider. Real integration uses disposable users and data in explicitly identified hosted test project; never production. Verify configured URLs/keys/database match, SMTP, localhost and Vercel browser flows, Data API disabled. No hosted credentials currently available: do not claim this acceptance step passed without evidence.

## Documentation

Record ADR superseding offline Better Auth choice, update staff-account terms, environment example, deployment runbook and ticket 11. Trusted CLI invites first owner; dashboard cannot create owners. Resend SMTP for Auth; chat alerts unchanged. Operator-assisted MFA recovery with identity verification and session revocation. Archive old source intact; migrate configuration with obsolete staff attribution cleared.

## Comments

- 2026-11-15: Local implementation, isolated-provider tests, production build, migrations, configuration-transfer tooling, ADR, glossary, and deployment runbook are complete. Hosted acceptance is waiting for the dedicated Supabase test project URL/credentials, Vercel test project URL, and first-owner email. Secrets must be configured in local/Vercel environment settings, not added to this issue.
