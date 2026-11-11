# Production deployment: Vercel + Supabase (ticket 11)

This runbook takes the chatbot from local SQLite development to Vercel with
Supabase Postgres. It is written to be executed by the site owner (or IT) in
one sitting; every command is repeatable and every verification is printed.

## 1. Environment and secrets

Everything the server needs is environment configuration — nothing secret is
in the repo or any client bundle:

| Variable | Purpose | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Supabase Postgres connection string | Use the **connection pooler** (port 6543, transaction mode) URL from the Supabase dashboard. Server-only; never `NEXT_PUBLIC_`. |
| `BETTER_AUTH_SECRET` | Signs sessions, encrypts TOTP secrets | Generate once (`openssl rand -base64 32`); **rotating it invalidates enrolled TOTP**, so set it before staff enroll and leave it fixed. |
| `CHATBOT_BASE_URL` | Public origin, e.g. `https://chatbot.springfieldcollege.edu` | Drives trusted origins, email links, CSRF checks. |
| `RESEND_API_KEY` + `MAIL_FROM` | Approved transactional email sender | Production refuses to start without them (alerts must never vanish into a local outbox). |
| `CRON_SECRET` | Authorizes the scheduled maintenance route | Any long random string; Vercel sends it as a bearer token. |

Local development keeps using SQLite (`CHATBOT_DB`, default `chatbot.db`) and
needs none of these.

## 2. Provision Supabase

1. Create the project; note the pooled connection string as `DATABASE_URL`.
2. Network: if the dashboard offers IP restrictions, allow Vercel's egress or
   leave open (credentials authenticate; TLS encrypts).
3. Confirm the Postgres version is 15+ (the app uses plain SQL from
   `migrations/postgres/`; nothing version-specific).

The application creates its own schema: on first start it applies
`migrations/postgres/0001-0003` (tracked in `_migrations`). No manual SQL is
required.

## 3. Migrate the data (repeatable)

From a machine that can reach both the SQLite file and Supabase:

```
npx tsx scripts/migrate-sqlite-to-postgres.ts --url "$DATABASE_URL" --sqlite chatbot.db
```

The script:

- applies the Postgres migrations first,
- **truncates and re-copies** every table inside one transaction, so reruns
  converge (never duplicate) — safe to run as often as needed before cutover,
- copies identifiers, ISO-8601 timestamps, and JSON payloads verbatim, and
  casts Better Auth's boolean/timestamptz columns,
- prints per-table count comparisons and referential spot checks, exiting
  nonzero if any FAIL appears.

Expected: `user`/`session`/`account`/`verification`/`twoFactor` carry staff
identities; conversations, messages, visitor sessions, return tokens, rules,
settings, notifications, audit, retention, and analytics all match the source.

**Bootstrap the first owner.** Production seeds no accounts on first boot.
With `DATABASE_URL` (or `POSTGRES_URL`) exported, run the bootstrap from a
machine that can reach Supabase — it targets the store the running app
would use, applying the tracked migrations first, so a fresh project works
before any deploy:

```
npx tsx scripts/bootstrap-owner.ts --email owner@example.edu --password '…' --name 'College Owner'
```

Its output names the store it wrote (`Targeted store: Postgres database at
…`, credentials never printed). Without `DATABASE_URL` the script
provisions the local SQLite development file and says so in its output —
that run never touches production. The owner signs in at
`/dashboard/login`, enrolls an authenticator (TOTP) on first sign-in, and
invites the remaining staff from the dashboard. An email that already
exists fails the run without changing that account.

**Rehearsal note:** run the whole flow suite against Postgres before cutover:

```
CHATBOT_TEST_POSTGRES_URL="postgres://.../postgres" npm test
```

Every API-flow test (concurrency, email, disablement, retention, analytics)
executes against a per-file Postgres database; SQLite remains the default.

## 4. Cutover

1. Announce a short staff window; the desk becomes read-only by convention
   (no claims/replies) until step 5.
2. Final migration run with session revocation:

   ```
   npx tsx scripts/migrate-sqlite-to-postgres.ts --url "$DATABASE_URL" --sqlite chatbot.db --revoke-sessions
   ```

   Staff sessions do not migrate: every staff member signs in again with
   password + TOTP. Accounts, password hashes, and TOTP enrollments migrate
   (keep `BETTER_AUTH_SECRET` identical to the value used when they enrolled).
3. Deploy to Vercel with the environment table above.
4. Open the dashboard, sign in, verify: answer rules published, conversation
   history in History, analytics populated, settings intact.
5. Staff sign in again (multifactor), confirm their desk, and resume.
6. Switch the WordPress embed's loader URL to the production origin if it
   differs (the plugin's `sfc_chatbot_widget_url` filter or the script src).

## 5. Rollback and backups

- **Backups:** Supabase dashboard → Database → Backups (daily on paid
  plans); for point-in-time recovery enable PITR before cutover. Additionally
  take a manual backup right before cutover. The SQLite file remains the
  pre-migration snapshot — archive it (`chatbot.db` + WAL files) read-only.
- **Rollback before traffic switches:** nothing to do — the WordPress embed
  still points at the old host (or the app is not yet public). Redeploy after
  fixing whatever the verification flagged.
- **Rollback after traffic switches:** point the embed/loader back at a
  SQLite-backed host restored from the archived `chatbot.db`; conversations
  created since cutover on Postgres would be lost unless exported first, so
  decide quickly and note the cutover timestamp.
- **Data loss bounds:** visitor sessions and return tokens expire naturally
  (24 h); transcripts are subject to the configured retention; analytics
  rollups are non-critical aggregates.

## 6. Scheduled maintenance

`vercel.json` schedules `GET /api/maintenance` daily at 03:17 UTC. It runs
the transcript retention sweep (ticket 10) and analytics expiry (ticket 17).
Vercel's cron sends `Authorization: Bearer $CRON_SECRET`; without a configured
secret, the route accepts same-origin dashboard traffic (the pre-existing
staff-traffic trigger), and setting `CRON_SECRET` takes over entirely.

## 7. Pre-launch approvals and security review (owner/IT sign-off)

Approve each external service and data decision explicitly — these five are
the launch gates from the spec:

- [ ] **Vercel** approved as the hosting platform (US/EU region choice
      recorded; env secrets entered in the Vercel dashboard).
- [ ] **Supabase** approved as the data processor (project region, backups
      and PITR enabled per §5, connection string restricted to the server).
- [ ] **Email delivery** approved (the transactional sender and its verified
      from-address; alert and return-link bodies reviewed — no transcripts).
- [ ] **Data access** approved (who can read the dashboard, who holds owner,
      what visitor data exists — no IPs, hashed anonymous ids only per
      ADR 0002).
- [ ] **Retention** approved (transcript period and analytics window set in
      the dashboard; expiry verified by the maintenance route).

Then run the security review:

- **Bundles and responses:** inspect a production page source and the
  `/widget/v1.js` response — no connection strings, no `SUPABASE_*` or
  `RESEND_*` values, no `NEXT_PUBLIC_` secrets (there are none in the repo;
  confirm at runtime).
- **Authorization on every route:** staff APIs require session + verified
  email + 2FA + role (`src/api/staff.ts requireStaff`); visitor APIs are
  credential-scoped (a bearer unlocks exactly its conversation); analytics
  requires staff; settings require owner. The suite asserts each of these on
  both backends.
- **Visitor isolation:** cross-visitor reads return 404 (tested).
- **CSRF:** every cookie-authenticated state-changing route enforces the
  same-origin guard; public POSTs (presence, conversations) are
  origin-checked and rate-limited, and no IP address is persisted anywhere.
- **Login abuse:** better-auth rate limits sign-in/verify-TOTP/reset; wrong
  credentials answer generically (tested).
- **Session revocation:** disable, password reset, and "sign out everywhere"
  delete session rows (tested); cutover revokes all staff sessions.
- **WordPress embed boundary:** the loader only renders an iframe to the
  chatbot origin and touches no page storage; the visitor credential lives in
  iframe-origin sessionStorage; the analytics browser id is an anonymous
  rotating UUID on the chatbot origin (ADR 0002).
- **HTTPS:** Vercel terminates TLS; `useSecureCookies` follows
  `NODE_ENV=production`.
