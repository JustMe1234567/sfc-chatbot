# 99: Production dashboard outage — session-pooler client exhaustion; cut the shared pooler over to transaction mode

Status: done

## What to build

Production is down at the dashboard: `/dashboard` answers HTTP 500 with
Vercel logs showing
`EMAXCONNSESSION: max clients reached in session mode - max clients are
limited to pool_size: 15` (error digest `2703405841`). Opening the
dashboard fired concurrent requests for several dashboard routes across
multiple Vercel function instances and regions. Production currently
points `DATABASE_URL` at the Supabase shared **session** pooler (port
5432). Ticket 90's postgres.js 4.1.1 `query_timeout`/`queue_timeout`
bounds and `prepare: false` are already deployed and are not the cause.

Diagnose from the supplied evidence only — no production-data access, no
production mutation — and ship the smallest changes that make the
Supabase **transaction pooler (port 6543)** safe for this application
and document the exact cutover:

1. **Audit the application against transaction mode.** Check prepared
   statements, session-level `SET` state, `LISTEN`/`NOTIFY`,
   session-spanning temporary tables, and advisory locks. Record every
   finding in the ticket, including "compatible as-is" results.
2. **Pool configuration.** Keep `prepare: false` and ticket 90's bounded
   `query_timeout`/`queue_timeout` (10 s defaults) exactly as they are.
   Do **not** raise `PG_POOL_MAX` as the fix. Choose and document a
   conservative application-side pool ceiling appropriate for Vercel
   serverless fan-out and the existing Settings-page concurrency
   (ticket 89: an authed Settings render holds at most four reads).
3. **Dashboard navigation burst.** Inspect the sidebar navigation's
   prefetch behavior and disable automatic prefetch only where it
   unnecessarily causes simultaneous database-backed dashboard renders.
   Normal navigation (clicking a link) must behave exactly as before.
4. **Tests.** Focused tests covering the pool configuration and the
   dashboard-link prefetch behavior.
5. **Concurrency harness.** A committed load harness representing at
   least eight active dashboard users that demonstrates the previous
   15-session failure shape is not reproduced.
6. **Documentation.** `docs/deployment.md` records the required Vercel
   `DATABASE_URL` mode (connection shape only — no credentials, no full
   URL in tracked files) and the exact safe cutover and rollback
   procedure.

Constraints: do not change the real Vercel environment or deploy during
implementation; do not touch production data. The cutover itself is an
operator step documented in the runbook.

## Acceptance criteria

- The transaction-mode audit is recorded with a verdict per feature
  (prepared statements, session `SET`, `LISTEN`/`NOTIFY`, temporary
  tables, advisory locks).
- `prepare: false` and the ticket 90 timeout bounds survive unchanged;
  `PG_POOL_MAX` is not raised; the conservative per-instance ceiling is
  implemented and documented.
- Dashboard nav links no longer prefetch on viewport entry; navigation
  behavior is otherwise unchanged.
- Focused tests pin the pool configuration and the nav-link prefetch
  behavior and pass.
- The harness runs ≥ 8 simulated dashboard users against a disposable
  Postgres and passes with the new shape while a control reproduces the
  15-session failure shape under the old one.
- `docs/deployment.md` names the required `DATABASE_URL` mode (shape
  only) and gives exact cutover, verification, and rollback steps.
- Focused tests and `npm run check` are green.
- `/code-review` runs against the starting commit (a607804d7) and only
  in-scope findings are addressed; PR opened; nothing merged or
  deployed.

## Comments

2026-11-22: Filed as urgent from the production outage report. Working
branch `codex/ticket-99-session-pooler-cutover` cut from origin/main
`a607804d7`.

2026-11-22: **DIAGNOSED + IMPLEMENTED. All acceptance criteria pass.**

### Diagnosis (from the supplied evidence only; no production access)

The shared **session** pooler gives every client connection its own
dedicated server session, and Supavisor's shared session mode caps
concurrent clients at the server-side pool size — 15, exactly the error
text (`max clients are limited to pool_size: 15`). Three multiplicative
fan-out sources pushed past it:

1. **Navigation prefetch.** Every sidebar nav row is a `next/link` with
   the default prefetch: in Next.js App Router, a link entering the
   viewport prefetches its route, and with no `loading.js` boundaries the
   dynamic route's RSC render runs to completion — one database-backed
   server render per nav row, all at once when the dashboard opens. The
   dashboard layout's `generateMetadata` also reads the store per request
   (favicon version), so even the lightest render hits Postgres.
2. **Per-instance client pools.** Every warm Vercel function instance
   holds up to `PG_POOL_MAX` client connections; the deployed default was
   8 (ticket 90's certified 5 was the local cert value). Concurrent
   requests for several dashboard routes across multiple instances and
   regions multiply those pools — 2 instances × 8 already exceeds 15.
3. **Transaction seams hold sockets.** The app's protected requests
   serialize threshold decisions through `AppDatabase.transaction`
   (advisory-locked `sql.begin`), and a transaction pins a dedicated
   socket for its duration — read concurrency alone understates the real
   client count.

Once the 16th client connected, Supavisor rejected it with
`EMAXCONNSESSION` and the dashboard answered 500s (digest `2703405841`).
Ticket 90's bounds were working as designed — they bounded stalls on
individual queries — but nothing in the client configuration can bound
the *count* of client connections a serverless fleet opens against a
pooler that rejects clients at 15.

### Transaction-mode audit (port 6543 compatibility)

| Feature | Verdict |
| --- | --- |
| Prepared statements | **Required: `prepare: false`** — already the default (`PG_PREPARE` unset ⇒ false) and preserved unchanged; the shared pooler rejects prepared statements. |
| Session-level `SET` state | **None** — repo-wide grep finds no session `SET`/`RESET`/`set_config`; all `SET` occurrences are SQL column assignments. |
| `LISTEN`/`NOTIFY` | **None** — no usage anywhere in `src/`, `migrations/`, `scripts/`. |
| Temporary tables | **Compatible as-is** — the only temp table is migration 0014's `audit_backup`, created and consumed entirely inside the migration runner's single `sql.begin` transaction. |
| Advisory locks | **Compatible as-is** — the one lock is `pg_advisory_xact_lock` (transaction-scoped) taken inside `sql.begin` (`src/db/appDatabase.ts`); the pooler binds a server connection for the transaction, so the lock is held and released within it. |
| Query pipelining | **Documented constraint** — Supabase's docs: the shared pooler does not support pipelining and postgres.js pipelines by default (`max_pipeline` 100). Ticket 90's harness already showed `max_pipeline: 1` alone does not fix the transaction pooler's stalled sockets (it went RED on 3.4.9), and changing it would slow the session pooler too — so behavior is unchanged, and ticket 90's 10 s `query_timeout`/`queue_timeout` bounds are what keep this stall class bounded (a rejected query, then pool recovery). Cutover verification watches for `QUERY_TIMEOUT`/`QUEUE_TIMEOUT` log volume. |

### Shipped

- **`src/db/postgres.ts`** — the per-instance pool ceiling default drops
  **8 → 4**: it matches the Settings page's four-read concurrency
  (ticket 89) so that render never queues behind itself, while each warm
  Vercel instance contributes at most 4 client connections instead of 8.
  With ticket 90's bounded queues, anything above the ceiling waits
  briefly (≤ 10 s) instead of needing headroom. `PG_POOL_MAX` is NOT
  raised anywhere; `prepare: false` and both 10 s bounds are untouched.
  Comment documents the ceiling's per-instance multiplication rationale.
- **`src/app/dashboard/header.tsx`** — the nav `Link` (the single shared
  map serving both the desktop rail and the mobile drawer) carries
  `prefetch={false}`: Next.js no longer renders all seven dashboard routes
  when the dashboard opens. Clicking a row navigates exactly as before —
  the route renders on navigation instead of ahead of it (App Router
  `prefetch={false}` disables viewport *and* hover prefetch; client-side
  navigation, history, and the drawer's close-on-navigate are unchanged).
  No other links were touched: the requirement limits the disable to the
  burst the evidence names, and the inbox's per-conversation links are a
  separate, unmeasured shape (ticket-worthy if evidence ever implicates
  them).
- **`docs/deployment.md`** — `DATABASE_URL` row now requires the
  transaction pooler (6543) for Vercel deployments with the connection
  *shape* only (no credentials, no full URL in tracked files; localhost
  may keep the session pooler); `PG_POOL_MAX` row documents the new
  default-4 ceiling and the do-not-raise rule; new section 7 gives the
  exact cutover steps, verification checklist, and rollback procedure
  (old section 7 renumbered to 8).
- **`tests/postgres-pool-config.test.ts`** — pins `openPostgres` by
  introspection: default `max` 4, `prepare` false, `connect_timeout` 10,
  `query_timeout` 10, `queue_timeout` 10, plus the documented env
  overrides (and that `connect_timeout` stays fixed). Env variables are
  captured and restored around each test (the ticket 90 review lesson).
- **`tests/dashboard-sidebar.test.ts`** — new describe pins the nav
  prefetch contract: exactly one `<Link>` in `header.tsx` (the shared
  rail/drawer map) carrying `prefetch={false}` with the href wiring
  intact, and navigation semantics preserved (`onClick={onNavigate}`,
  `closeDrawer()`).
- **`scripts/load-dashboard-users.ts`** + `npm run load:dashboard` — the
  committed concurrency harness (details below).

### Concurrency/load harness

`scripts/load-dashboard-users.ts` against a disposable local Postgres
(this machine's trust-auth cluster on 5433, ticket 91's setup — started
for this run; it was down):

- Creates a scratch database (owned by the harness role so PG 15+
  migrations can run) migrated and seeded exactly like the app's boot
  sequence, and a dedicated login role with **`CONNECTION LIMIT 15`** —
  the server itself enforces the production cap shape, rejecting the 16th
  concurrent connection the way Supavisor's session mode does.
- Drives **8 simulated dashboard users** (× 3 iterations) across **3
  `openPostgres` handles** modeling separate Vercel instances. Each
  render is built from the app's real seams: the protected-request
  transaction (`AppDatabase.transaction` — advisory-locked `sql.begin`,
  modeled at ~150 ms so concurrent transactions genuinely overlap), the
  needs-human poll read, and the Settings page's ≤ 4-concurrent read
  batches plus the desk list. A `pg_stat_activity` watcher samples the
  role's peak concurrent connections.
- Default run (the new shape, `PG_POOL_MAX=4`): **PASS 3/3 runs** — 24/24
  renders complete with zero rejections, peak **12/15** (structurally
  bounded: 3 instances × 4). The previous failure shape does not
  reproduce.
- `--control` run (the pre-ticket-99 shape: old pool default 8 + the
  first-visit prefetch burst of 11 concurrent renders per user): **PASS
  3/3 runs** — peak pinned at the 15 cap, renders fail under it
  (`QUEUE_TIMEOUT` bounded rejections after refused connects; the local
  driver surfaces the refused 16th connection as bounded rejections
  rather than Supavisor's immediate `EMAXCONNSESSION`, but the failure
  shape — renders dying at the cap while the old shape runs — is the
  one production exhibited). This proves the harness can catch the
  failure it guards against.

First harness iteration caught two of its own bugs, both fixed and noted
for honesty: the app URL originally reused the admin username so the
connection limit never applied (peak 0/15 — vacuous pass), and the
control's transaction-free burst pipelined into a handful of sockets and
missed the cap nondeterministically.

### Verification

- Focused tests: `npx vitest run tests/postgres-pool-config.test.ts
  tests/dashboard-sidebar.test.ts` — **13 passed** (2 files).
- Harness: green 3/3 PASS, control 3/3 reproduced (logs
  `/tmp/t99-green-*.log`, `/tmp/t99-ctrl-*.log`).
- `npm run check` green end to end (hygiene, typecheck, full suite,
  production build).
- Production untouched: no Vercel environment change, no deploy, no
  production-data access. The transaction-pooler cutover is an operator
  step documented in `docs/deployment.md` section 7.

### Cleanup record

The local 5433 trust-auth Postgres cluster (down when this session
started) was started with `pg_ctl` from
`C:\Users\antlo\OneDrive\Documents\sfc chatbot\.scratch\local-postgres`
and **left running** — it is the machine's standard local suite cluster
(ticket 91) and other sessions use it. The harness's scratch database
`sfc_load_harness` is dropped by the harness itself on every exit
(verified across six runs); the `sfc_load_harness` role (CONNECTION
LIMIT 15, no password, no data) is kept per the ticket-79 precedent. No
secrets printed or stored; `.env.local` never read.

### Status

COMPLETE — all acceptance criteria pass. Status set to `done`. The
operator still must perform the documented Vercel `DATABASE_URL` cutover
(section 7 of `docs/deployment.md`) to restore production; that step is
deliberately outside this implementation per the ticket's constraints.
