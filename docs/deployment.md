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
| `DATABASE_URL` | Postgres connection for the same project. **Two approved modes:** localhost, migrations, and operator scripts (bootstrap/recover/rename, config export/import, the load harness) use the **session pooler (port 5432)** — the standing `.env.local` shape `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres` — while the **Vercel runtime** uses the transaction pooler (**port 6543**) under the ticket-105 owner-approved, monitored retry (section 7). The session-mode URL is also the **rollback path** if the retry stalls. Set the real value only in `.env.local`/Vercel, never in tracked files. |
| `PG_POOL_MAX` | Postgres connection pool ceiling **per instance** (default 1). The ticket-105 approved runtime shape: with pipelining disabled (`max_pipeline: 1`), a busy socket queues waits behind ticket 90's bounded timeouts instead of opening a second pipeline, so one socket per instance is enough — and every warm Vercel instance contributes this many client connections to the pooler, so the small ceiling keeps the fleet footprint tiny. The Vercel runtime on the transaction-pooler retry must run at 1: set `PG_POOL_MAX=1` (or delete the variable) at cutover. Do not raise it to relieve pooler pressure; the fix for pooler pressure is fewer client connections, not more. |
| `PG_QUERY_TIMEOUT` | Seconds before an in-flight query is canceled and rejected (default 15, postgres.js ≥ 4.1; all postgres.js timeout values are seconds). The hosted pooler can silently stop answering individual queries; without this bound every affected connection holds its lease forever and the whole pool wedges (ticket 90). Well above this app's warm query times, far below the hosted statement timeout. |
| `PG_QUEUE_TIMEOUT` | Seconds before a query still waiting for a pool connection rejects (default 10). Complements `PG_QUERY_TIMEOUT`: bounds queue pileups so a stall surfaces as an error instead of a hung render. With the ticket-105 single-socket shape (`max: 1`, `max_pipeline: 1`) this is what bounds serialized waits. |
| `PG_IDLE_TIMEOUT` | Seconds an idle client connection closes after (default 10; 0 keeps sockets open until the instance dies, the pre-ticket-105 behavior). Released sockets reopen on demand, so a warm serverless instance stops squatting pooler client slots while quiet — the 2026-11-26 `EMAXCONNSESSION` outage mechanism (ticket 105). |
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

   Omitting `--password` reads it invisibly instead — a hidden keystroke prompt on a terminal, or the first line of piped stdin — so the password never lands in PowerShell history, npm output, or reports:

   ```powershell
   npm run recover:staff -- --username owner --identity-verified
   ```

3. The reset deletes every Auth session. It sends no email and never exposes the old password.

The command's explicit flag records that the human verification step happened; it does not perform that verification. Staff can also change their own password from Settings.

### Renaming a staff username (ticket 98)

A username lives in the application database only — sign-in resolves the username to the staff record and then uses the linked Auth user, whose identity keys on the preserved staff ID. Renaming therefore never touches Supabase Auth. Two operations, in this order:

1. Verify the account holder out-of-band, then run the guarded rename. It refuses unless the source is the one active owner account with a linked Auth user, the destination username is free case-insensitively, and `--identity-verified` is present; the rename itself is one transaction that changes only the username and its `updatedAt`:

   ```powershell
   npm run rename:staff -- --from owner --to sfc-admin --identity-verified
   ```

2. Reset the password as a separate operation (it revokes every session, including the renamed account's). Enter the new password at the hidden prompt:

   ```powershell
   npm run recover:staff -- --username sfc-admin --identity-verified
   ```

The staff ID, linked Auth user, name, role, sessions, and all related records survive the rename unchanged; sign-in simply uses the new username with the same Auth credential until step 2 replaces it.

## 6. Localhost and Vercel test verification

Before starting localhost, follow `LOCALHOST.md`: verify port 3000, avoid duplicate servers, and update the file when state changes. Then verify:

- owner-created account login, wrong password refusal, single-stage sign-in with no authenticator challenge (ticket 82), reload/refresh, ordinary sign-out, and global sign-out;
- owner password reset, self-service password change, and session revocation;
- owner/staff/editor access, unprovisioned Auth user refusal, cross-origin mutations, disabling, and stale-session refusal;
- visitor chat, contact gate, handoff, takeover, reply, contacts, History, answer rules, settings, branding, and maintenance;
- no secret key or database URL in page source, scripts, widget assets, or API responses.

Deploy the same commit to the existing Vercel test project and repeat the browser flows on desktop and narrow screens. During a synthetic conversation, redeploy/recycle the Vercel function and confirm the conversation continues from Supabase Postgres. Use disposable staff usernames and synthetic conversations; record the exact created Auth user IDs and application record IDs, and clean up only those IDs.

## 7. Transaction-pooler runtime retry (tickets 99/105) and rollback

> **Status 2026-11-27 (ticket 105):** the owner-approved **controlled,
> monitored retry** was executed and verified in production the same day
> it shipped (PR #21, deployment `sfc-chatbot-6fmbg0xkt`, commit
> `6304d137a`): production `DATABASE_URL` moved to the transaction
> pooler (6543) with `PG_POOL_MAX=1`, and the ~26-minute verification
> window showed zero `EMAXCONNSESSION`, zero `QUERY_TIMEOUT`/
> `QUEUE_TIMEOUT`, and correct visitor-chat, escalation, and
> row-integrity behavior (ticket 105's completion record holds the
> counts). History that keeps this honest: the ticket-99 cutover was
> rolled back on 2026-11-22 when the shared transaction pooler's stall
> weather proved chronic (`QUERY_TIMEOUT` floods, tickets 100/101), and
> the 2026-11-26 session-pooler window showed its own failure mode, 57
> `EMAXCONNSESSION` client-cap rejections under idle-socket squatting
> (ticket 105). A chronic-weather return remains the known failure mode:
> if `QUERY_TIMEOUT`/`QUEUE_TIMEOUT` floods reappear, run the rollback
> in step 5. The session-pooler URL (5432) remains the rollback path at
> every step.

The shared session pooler (5432) gives every client connection its own
server session and rejects clients past the server-side pool size (15). A
Vercel deployment fans out: opening the dashboard fires several
database-backed renders across multiple function instances and regions,
each instance holding up to `PG_POOL_MAX` clients — enough to exceed 15
and answer 500s (`EMAXCONNSESSION: max clients reached in session mode`,
digest `2703405841`, 2026-11-22 outage, ticket 99; recurred 2026-11-26,
ticket 105). On the transaction pooler (port 6543) client connections
multiplex over the shared server sessions instead of each holding one,
so the runtime retry moves Vercel traffic there while localhost,
migrations, and operator scripts stay on direct/session connections
(their own environment's URL — locally `.env.local`'s 5432; no script
URL source changes).

Transaction-mode compatibility (the ticket 99 audit, sharpened by
ticket 105): the client runs `prepare: false` (required — the shared
pooler rejects prepared statements) and `max_pipeline: 1` (required —
the transaction pooler does not support query pipelining, and postgres.js
pipelines up to 100 queries per socket by default; the documented combo
can hang queries or return mismatched rows, so one in-flight query per
socket is the protocol-safe shape). The runtime pool runs `max: 1`
single-socket per instance — concurrent work queues behind
`queue_timeout` (10 s) rather than opening a second pipeline — and
`idle_timeout: 10` releases idle client sockets so warm instances stop
squatting pooler slots. The application uses no session-level `SET`
state, no `LISTEN`/`NOTIFY`, and no temporary table that outlives a
transaction (migration 0014's temp table lives entirely inside one
migration transaction); the one advisory lock
(`pg_advisory_xact_lock` in `src/db/appDatabase.ts`) is
transaction-scoped and taken inside `sql.begin`, which transaction mode
supports. All postgres.js timeout values are seconds. Because the
2026-11-22 chronic stall weather happened with protocol-unsafe pipelining
and does not have a known client-side cure, cutover verification watches
for `QUERY_TIMEOUT`/`QUEUE_TIMEOUT` volume as the retry's known failure
mode — bounds turn a stall into a bounded rejection, not a fix.

Cutover (owner steps only; no tracked-file change), executed only after
the ticket-105 PR is merged and deployed:

1. In the Supabase dashboard, copy the project's transaction-pooler
   connection string (Connect → Transaction pooler, port 6543). It has the
   shape `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`. Never commit or paste it into tracked files.
2. In Vercel, set `DATABASE_URL` to that value for the production and
   preview environments, and set `PG_POOL_MAX=1` (or delete the
   variable — the code default is 1). It must not remain at the older
   value of 4: the approved runtime pool size is 1.
3. Redeploy so the new environment reaches every function instance.
4. Verify: `/api/healthz` answers 200; the login page loads; an authed
   sign-in reaches `/dashboard` and opens every nav route without 500s;
   the needs-human bell poll answers during a staff dashboard session;
   Vercel logs show no `EMAXCONNSESSION` and no chronic
   `QUERY_TIMEOUT`/`QUEUE_TIMEOUT` weather (isolated bounded rejections
   are the bounds working; a repeating flood is the 2026-11-22 failure
   mode returning).
5. Rollback: revert `DATABASE_URL` in Vercel to the previous
   session-pooler URL (5432) and redeploy — keep the session-mode URL
   available for exactly this. The rollback inherits the ticket-105
   client shape, which shrinks the session-mode fan-out risk on its own:
   `max: 1` caps a fleet at ~one socket per warm instance and
   `idle_timeout: 10` releases idle sockets, so the 15-client cap is no
   longer held indefinitely by quiet instances. A burst across enough
   instances can still exceed 15 clients — accepted and watched via the
   log volume, as recorded for the 2026-11-26 recurrence (ticket 105).

## 8. Production boundary and rollback

This delivery does not create the production deployment or switch the public WordPress widget. Until that separate approval, the original host/database remains the rollback path and must not be modified. A failed test deployment is rolled back by redeploying the previous Vercel test build or deleting only the disposable test records; never point public traffic at the test project.
