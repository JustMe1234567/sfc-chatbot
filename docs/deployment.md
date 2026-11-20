# Test deployment: Vercel + Supabase Auth and Postgres

This runbook connects localhost and the Vercel test deployment to one dedicated Supabase test project. It transfers configuration only. The source database remains untouched, and production launch or WordPress traffic switching is a separate change.

## 1. Required environment

Set these in `.env.local` and the Vercel test project:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Dedicated test-project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser-safe project key used only for Auth sessions. |
| `SUPABASE_SECRET_KEY` | Server-only Auth administration key. Never expose or prefix with `NEXT_PUBLIC_`. |
| `DATABASE_URL` | Session-pooler Postgres connection (port 5432) for the same project. The transaction pooler (6543) intermittently stops answering queries on established connections under bursty load while the server side stays idle (ticket 90); the session pooler does not. |
| `PG_POOL_MAX` | Postgres connection pool ceiling (default 8). Must exceed the Settings page's read concurrency — an authed render holds at most four reads at once (ticket 89) — or the render can starve the pool alongside sidebar prefetches and the needs-human poller. |
| `PG_QUERY_TIMEOUT` | Seconds before an in-flight query is canceled and rejected (default 10, postgres.js ≥ 4.1). The hosted pooler can silently stop answering individual queries; without this bound every affected connection holds its lease forever and the whole pool wedges (ticket 90). Well above this app's warm query times, far below the hosted statement timeout. |
| `PG_QUEUE_TIMEOUT` | Seconds before a query still waiting for a pool connection rejects (default 10). Complements `PG_QUERY_TIMEOUT`: bounds queue pileups so a stall surfaces as an error instead of a hung render. |
| `CHATBOT_BASE_URL` | Exact app origin: localhost locally, Vercel test URL in Vercel. |
| `CRON_SECRET` | Vercel maintenance-route bearer token. |

Startup rejects missing Supabase values and rejects a project reference that differs between the project URL and database connection.

## 2. Configure the Supabase test project

1. Authentication → Providers → Email: enable email/password, disable public user signup, disable email confirmation, and set minimum password length to 10. Staff accounts are created only by the server-side owner/bootstrap workflows.
2. Authentication → URL Configuration:
   - Site URL: the Vercel test origin.
   - Redirect URLs: `http://localhost:3000` and the exact Vercel test origin. Do not add wildcards.
3. Do not configure custom SMTP or Auth email templates. The application sends no staff invitations, password recovery messages, or chat-alert email.
4. Data API integration overview: turn **Enable Data API** off. The application uses direct Postgres plus its own Next.js APIs, so REST/GraphQL table access is unnecessary. See Supabase's [Data API security guidance](https://supabase.com/docs/guides/api/securing-your-api#disable-the-data-api).
5. Do not store application roles in Auth user metadata. Roles and disablement live in `staff_members` and are checked on every protected request.

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

## 4. Create the first owner

With the test-project environment loaded:

```powershell
npm run bootstrap:owner -- --username owner --password "choose-at-least-10-characters" --name "College Owner"
```

The command applies migrations and creates both the application staff record and Supabase Auth user. The password is provided only as process input and is not printed or stored by the application. The owner signs in with that username and password — single-stage, no authenticator (ADR-0006).

Owners create staff/editor accounts from the Staff page by assigning a name, unique username, role, and initial password. Usernames are lowercase and case-insensitive. Public signup remains disabled.

On a deployment that predates ticket 82, run the one-time factor cleanup once after redeploying, so no account is left with a half-enrolled authenticator in hosted Auth:

```powershell
npx tsx scripts/remove-enrolled-factors.ts
```

Staff members who still hold the old Springfield entry in an authenticator app can delete it; the app no longer participates in sign-in.

## 5. Lost-password recovery

1. Verify the staff member using the college's approved out-of-band identity procedure. Do not rely on an email request alone.
2. An owner resets the password from the Staff page. For a lost owner password, run the trusted operator command:

   ```powershell
   npm run recover:staff -- --username owner --password "new-10+-character-password" --identity-verified
   ```

3. The reset deletes every Auth session. It sends no email and never exposes the old password.

The command's explicit flag records that the human verification step happened; it does not perform that verification. Staff can also change their own password from Settings.

## 6. Localhost and Vercel test verification

Before starting localhost, follow `LOCALHOST.md`: verify port 3000, avoid duplicate servers, and update the file when state changes. Then verify:

- owner-created account login, wrong password refusal, single-stage sign-in with no authenticator challenge (ticket 82), reload/refresh, ordinary sign-out, and global sign-out;
- owner password reset, self-service password change, and session revocation;
- owner/staff/editor access, unprovisioned Auth user refusal, cross-origin mutations, disabling, and stale-session refusal;
- visitor chat, contact gate, handoff, takeover, reply, contacts, History, answer rules, settings, branding, and maintenance;
- no secret key or database URL in page source, scripts, widget assets, or API responses.

Deploy the same commit to the existing Vercel test project and repeat the browser flows on desktop and narrow screens. During a synthetic conversation, redeploy/recycle the Vercel function and confirm the conversation continues from Supabase Postgres. Use disposable staff usernames and synthetic conversations; record the exact created Auth user IDs and application record IDs, and clean up only those IDs.

## 7. Production boundary and rollback

This delivery does not create the production deployment or switch the public WordPress widget. Until that separate approval, the original host/database remains the rollback path and must not be modified. A failed test deployment is rolled back by redeploying the previous Vercel test build or deleting only the disposable test records; never point public traffic at the test project.
