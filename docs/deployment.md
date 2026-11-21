# Test deployment: Vercel + Supabase Auth and Postgres

This runbook connects localhost and the Vercel test deployment to one dedicated Supabase test project. It transfers configuration only. The source database remains untouched, and production launch or WordPress traffic switching is a separate change.

This single Supabase project (`bmlwasuvujkfchnbklls`) is shared with production: the production Vercel deployment serves the same database, where the production owner identity, live staff rows, and real login_events all live. Every mutation against it — owner bootstrap, certification identities, SQL deletes — is a production mutation and must be handled with production care. Certification recipes (cert70/81/82) bootstrap disposable identities on this shared project and fully clean them up afterward.

## 1. Required environment

Set these in `.env.local` and the Vercel test project:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Dedicated test-project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser-safe project key used only for Auth sessions. |
| `SUPABASE_SECRET_KEY` | Server-only Auth administration key. Never expose or prefix with `NEXT_PUBLIC_`. |
| `DATABASE_URL` | Vercel deployments (test and production) require the **transaction pooler** on port 6543 — see section 7 for the cutover, the failure it fixes, and rollback. The connection shape is `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`; set the real value only in `.env.local`/Vercel, never in tracked files. A single-process localhost keeps the session pooler (5432): session mode is safe for one instance, and the client cap only bites under serverless fan-out. The transaction pooler's known stalled-socket behavior under bursts (ticket 90) stays bounded by `PG_QUERY_TIMEOUT`/`PG_QUEUE_TIMEOUT`: a stall surfaces as a per-query rejection and the pool recovers. |
| `PG_POOL_MAX` | Postgres connection pool ceiling **per instance** (default 4). Conservative by design (ticket 99): every warm Vercel instance contributes up to this many client connections to the pooler, and a burst across instances multiplies them. 4 matches the Settings page's read concurrency — an authed render holds at most four reads at once (ticket 89) — so that render never queues behind itself, and anything above it queues briefly behind ticket 90's bounded 10-second wait instead of needing headroom. Do not raise it to relieve pooler pressure — the fix for pooler pressure is the transaction pooler (6543) plus this ceiling, not more client connections. |
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

## 7. Transaction-pooler cutover (ticket 99) and rollback

The shared session pooler (5432) gives every client connection its own
server session and rejects clients past the server-side pool size (15). A
Vercel deployment fans out: opening the dashboard fires several
database-backed renders across multiple function instances and regions,
each instance holding up to `PG_POOL_MAX` clients — enough to exceed 15
and answer 500s (`EMAXCONNSESSION: max clients reached in session mode`,
digest `2703405841`, 2026-11-22 outage, ticket 99). Vercel deployments
therefore run the transaction pooler on port 6543, where client
connections multiplex over the shared server sessions instead of each
holding one.

Transaction-mode compatibility (the ticket 99 audit): the client runs
`prepare: false` (required — the shared pooler rejects prepared
statements) with ticket 90's 10 s `query_timeout`/`queue_timeout` bounds
preserved unchanged. The application uses no session-level `SET` state,
no `LISTEN`/`NOTIFY`, and no temporary table that outlives a transaction
(migration 0014's temp table lives entirely inside one migration
transaction); the one advisory lock (`pg_advisory_xact_lock` in
`src/db/appDatabase.ts`) is transaction-scoped and taken inside
`sql.begin`, which transaction mode supports. postgres.js pipelines
queries by default, which the shared pooler does not support — ticket
90's bounds are what keep that stall class bounded (a rejected query, then
pool recovery), so cutover verification watches for
`QUERY_TIMEOUT`/`QUEUE_TIMEOUT` log events.

Cutover (operator steps only; no code or tracked-file change):

1. In the Supabase dashboard, copy the project's transaction-pooler
   connection string (Connect → Transaction pooler, port 6543). It has the
   shape `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`. Never commit or paste it into tracked files.
2. In Vercel, set `DATABASE_URL` to that value for the production and
   preview environments. Leave `PG_POOL_MAX` unset (the code default 4)
   or set it to 4; do not raise it.
3. Redeploy so the new environment reaches every function instance.
4. Verify: `/api/healthz` answers 200; the login page loads; an authed
   sign-in reaches `/dashboard` and opens every nav route without 500s;
   Vercel logs show no `EMAXCONNSESSION` and no unexpected
   `QUERY_TIMEOUT`/`QUEUE_TIMEOUT` volume.
5. Rollback: revert `DATABASE_URL` in Vercel to the previous session-pooler
   URL (5432) and redeploy. With prefetch disabled (ticket 99) and the
   pool ceiling at 4, the session-mode fan-out risk is reduced but not
   eliminated — a burst across enough instances can still exceed 15
   clients — so treat the rollback as temporary until the transaction
   pooler is re-attempted.

## 8. Production boundary and rollback

This delivery does not create the production deployment or switch the public WordPress widget. Until that separate approval, the original host/database remains the rollback path and must not be modified. A failed test deployment is rolled back by redeploying the previous Vercel test build or deleting only the disposable test records; never point public traffic at the test project.
