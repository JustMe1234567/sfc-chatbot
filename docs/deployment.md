# Test deployment: Vercel + Supabase Auth and Postgres

This runbook connects localhost and the Vercel test deployment to one dedicated Supabase test project. It transfers configuration only. The source database remains untouched, and production launch or WordPress traffic switching is a separate change.

## 1. Required environment

Set these in `.env.local` and the Vercel test project:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Dedicated test-project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser-safe project key used only for Auth sessions. |
| `SUPABASE_SECRET_KEY` | Server-only Auth administration key. Never expose or prefix with `NEXT_PUBLIC_`. |
| `DATABASE_URL` | Transaction-pooler Postgres connection for the same project. |
| `CHATBOT_BASE_URL` | Exact app origin: localhost locally, Vercel test URL in Vercel. |
| `RESEND_API_KEY`, `MAIL_FROM` | Existing application alert delivery. Supabase Auth email uses the SMTP configuration below. |
| `CRON_SECRET` | Vercel maintenance-route bearer token. |

Startup rejects missing Supabase values and rejects a project reference that differs between the project URL and database connection.

## 2. Configure the Supabase test project

1. Authentication → Providers → Email: enable email/password and disable public user signup. Set minimum password length to 10.
2. Authentication → URL Configuration:
   - Site URL: the Vercel test origin.
   - Redirect URLs: `http://localhost:3000` and the exact Vercel test origin. Do not add wildcards.
3. Authentication → Email Templates:
   - Invite link: `{{ .RedirectTo }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=invite`
   - Recovery link: `{{ .RedirectTo }}/api/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`
   - Keep messages transactional and disable provider click tracking so links are not rewritten. Supabase documents the server-side `TokenHash` pattern in its [email-template guide](https://supabase.com/docs/guides/auth/auth-email-templates).
4. Authentication → SMTP: enable custom SMTP with Resend:
   - Host `smtp.resend.com`
   - Port `465`
   - Username `resend`
   - Password: a Resend API key stored only in the dashboard
   - Sender: the verified college domain/address
   Resend documents these values in its [SMTP service guide](https://resend.com/changelog/smtp-service); Supabase recommends custom SMTP for invitations and recovery mail in its [SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp).
5. Data API integration overview: turn **Enable Data API** off. The application uses direct Postgres plus its own Next.js APIs, so REST/GraphQL table access is unnecessary. See Supabase's [Data API security guidance](https://supabase.com/docs/guides/api/securing-your-api#disable-the-data-api).
6. Do not store application roles in Auth user metadata. Roles and disablement live in `staff_members` and are checked on every protected request.

## 3. Transfer configuration into a fresh target

The bundle includes ordered answer rules, lifecycle/publication state, settings, handoff phrases/options, and branding data URLs. It clears `published_by`. It excludes staff, Auth users, sessions, conversations, messages, contacts, audit/history, notifications, analytics, and rate limits.

Export from exactly one read-only source; the output path must not already exist:

```powershell
$env:CONFIG_SOURCE_SQLITE_PATH = "C:\archive\chatbot.db"
$env:CONFIG_BUNDLE_PATH = "C:\transfer\chatbot-config.json"
npm run config:export
```

For a Postgres source, set `CONFIG_SOURCE_DATABASE_URL` instead of `CONFIG_SOURCE_SQLITE_PATH`. Then import into the unused test project:

```powershell
$env:CONFIG_TARGET_DATABASE_URL = $env:DATABASE_URL
npm run config:import
```

The import runs in one transaction, refuses any target containing application data, and validates rule order/status, row counts, and every settings/branding hash before commit. Archive the bundle and source database read-only; never rerun import after the app or owner bootstrap has used the target.

## 4. Invite the first owner

With the test-project environment loaded:

```powershell
npm run bootstrap:owner -- --email owner@example.edu --name "College Owner"
```

The command applies migrations, creates the application staff record, and sends a Supabase invitation. It never accepts or prints a password. The owner follows the email link, creates a password, enrolls TOTP, signs out, and signs in again with password plus authenticator.

Owners invite staff/editor accounts from the Staff page. Re-sending a pending invitation keeps the original name and role. Accepted or disabled accounts cannot be reinvited through that endpoint.

## 5. Lost-authenticator recovery

1. Verify the staff member using the college's approved out-of-band identity procedure. Do not rely on an email request alone.
2. Run within the next maintenance window:

   ```powershell
   npm run recover:staff -- --email member@example.edu --identity-verified
   ```

3. The command deletes every Auth session and factor, records a 30-minute operator approval, and sends a recovery email.
4. The member sets a new password, signs in, and enrolls a new authenticator before dashboard access resumes.

Without the operator approval, password recovery requires the existing TOTP factor. The command's explicit flag records that the human verification step happened; it does not perform that verification.

## 6. Localhost and Vercel test verification

Before starting localhost, follow `LOCALHOST.md`: verify port 3000, avoid duplicate servers, and update the file when state changes. Then verify:

- invitation acceptance, expired/replayed link refusal, password login, TOTP enrollment/challenge, reload/refresh, ordinary sign-out, and global sign-out;
- forgotten password with existing TOTP, operator recovery, and mandatory reenrollment;
- owner/staff/editor access, unprovisioned Auth user refusal, cross-origin mutations, disabling, and stale-session refusal;
- visitor chat, contact gate, handoff, takeover, reply, contacts, History, answer rules, settings, branding, and maintenance;
- no secret key or database URL in page source, scripts, widget assets, or API responses.

Deploy the same commit to the existing Vercel test project and repeat the browser flows on desktop and narrow screens. During a synthetic conversation, redeploy/recycle the Vercel function and confirm the conversation continues from Supabase Postgres. Use disposable staff emails and synthetic conversations; record the exact created Auth user IDs and application record IDs, and clean up only those IDs.

## 7. Production boundary and rollback

This delivery does not create the production deployment or switch the public WordPress widget. Until that separate approval, the original host/database remains the rollback path and must not be modified. A failed test deployment is rolled back by redeploying the previous Vercel test build or deleting only the disposable test records; never point public traffic at the test project.
