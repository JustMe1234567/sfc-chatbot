# 89: Settings page's 8 concurrent reads starve the Postgres pool

Status: needs-triage

## What to build

The reworked Settings page (the notifications-page removal moved the
support-hours, transcript-retention, login-retention, and embed-allowlist
cards onto it) server-renders eight settings reads in a single
`Promise.all`. On a Postgres backend whose pool has no headroom — observed
with `PG_POOL_MAX=5` (the deployed recommendation) — the authed render
starves: the page's RSC render never completes, the browser navigation
times out, and the pool stays wedged for subsequent requests. Raising the
pool to 20 made the same render complete in ~2.6 s. The identical
concurrent `Promise.all` completes in 785 ms in a bare process, so the
starvation is specific to the server process's connection pool under
contending load (sidebar prefetches, the needs-human poller, and parallel
renders hold leases while the page wants eight at once).

The four extra reads arrived with the settings-page redesign (the review
range that deleted `/dashboard/notifications`); ticket 88's staff summary
did not add any query. Production has not exercised this page since that
redesign (no deploy since 2026-11-19), so the first real visit to Settings
on the deployed site can hang exactly this way.

Fix the smallest correct thing: batch the page's reads (for example two
sequential groups of four) so the render never needs more than half the
default pool at once, and record the pool-headroom requirement in
`docs/deployment.md`'s env table. Do not add retry/timeout machinery.

## Acceptance criteria

- The authed `/dashboard/settings` render issues at most four concurrent
  store reads at any moment.
- With `PG_POOL_MAX=5` against the hosted test project, an authed owner
  render of the Settings page completes promptly (the cert-run reproduction
  — a render that never finished in 90 s — no longer reproduces).
- `docs/deployment.md` documents that `PG_POOL_MAX` must exceed the
  settings page's read concurrency.
- Focused tests keep passing on both dialects; `npm run check` stays green.

## Comments

2026-11-20: Filed from the ticket 70/81/82 hosted-test certification run.
Reproduction recorded during the run: local production runtime on
`127.0.0.1:4388` against the hosted test project, `PG_POOL_MAX=5` — the
authed settings render hung indefinitely (instrumented render stopped
between the guard and the settings `Promise.all`); `PG_POOL_MAX=20` — the
same render finished in ~2.6 s. The bare-process probe of the identical
concurrent reads completed in 785 ms on the same store, ruling out the
queries themselves.

2026-11-20: IMPLEMENTED (the prescribed batching), one acceptance criterion
blocked by a newly-characterized, deeper defect — details and the decision
point below.

**Shipped** (`src/app/dashboard/settings/page.tsx`): the eight reads now run
as two sequential `Promise.all` groups of four (branding + support hours,
then retention + allowlist), values and ordering unchanged; the owner/staff
role gates and ticket 88's read-only staff summary are untouched. No retry
or timeout machinery was added and the pool was not raised, per the ticket.

**Regression test** (`tests/settings-page-read-concurrency.test.ts`): a
deterministic, agent-runnable reproduction at the real seam. It mocks only
`next/headers` (the ticket-73 pattern from `empty-successors.test.ts`) and
wraps the exact `db`/`store` handles the page resolves from
`getChatbotService` with an in-flight counter; the real page component is
then awaited directly for the owner, staff, and editor roles over a real
temp store. Every getter is invoked synchronously inside the old
`Promise.all`, so the peak measurement is exact: on the pre-fix code the
owner render measures **8 concurrent reads** (test RED — the
over-subscription that starved the five-lease pool), post-fix **≤ 4**
(GREEN), on both dialects. The same tests pin every seeded Settings value
flowing to the rendered tree (support hours, 45/60-day retentions, embed
origin, chathead config, branding asset versions), the staff summary with
the owner cards absent, and editors seeing neither.

**Also shipped**: `docs/deployment.md`'s env table now documents
`PG_POOL_MAX` and its requirement to exceed the Settings page's four-read
concurrency.

**Verification**: focused tests green on SQLite and Postgres
(`CHATBOT_TEST_POSTGRES_URL` against the local 5433 cluster); full suite
577 passed / 6 skipped (SQLite) and 580 passed / 3 skipped (Postgres);
`npm run check` green end to end (hygiene, typecheck, suite, production
build).

**BLOCKED — the cert criterion (AC 2) does not hold, and not because of the
settings page.** cert70 on the local production runtime at `PG_POOL_MAX=5`
against the hosted test project failed twice: sign-in succeeded, then the
browser navigation to `/dashboard/settings` hit Playwright's 30 s goto
timeout. Evidence trail (scratch artifacts, untracked):
`cert89-probe.mjs`, `cert89-bare-probe*.mjs`, `cert89-burst-size.mjs`,
`cert89-activity.mjs`, `cert89-server.log`.

1. Sequential warm renders of the Settings page via curl complete in
   ~0.9–1.0 s at pool 5 — the batched page itself is fast.
2. The browser probe shows sidebar prefetch RSC renders completing in
   300–700 ms while the settings *document* hangs >90 s; afterwards the
   whole server pool is wedged (even `/dashboard/logs` hangs for minutes).
3. `pg_stat_activity` through the pooler at that moment: server side all
   idle (7 idle server connections, zero active/stuck, zero idle-in-
   transaction) — **the wedge is inside the app process's postgres.js
   pool**, not the database.
4. Bare-process reproduction with the app's exact pool options (`max: 5`,
   `prepare: false`, `connect_timeout: 10`, postgres.js 3.4.9, same
   DATABASE_URL): a burst of parallel renders wedges the pool permanently —
   every later query, even single sequential ones, hangs forever with no
   error. Pre-warming all five sockets does not prevent it;
   `idle_timeout`/`max_lifetime` do not prevent it; `max_pipeline: 1` is
   worse. Sequential traffic is always clean. In the current window a
   burst of 8 is clean and a burst of 16 wedges (10 ok / 6 hang, staying
   wedged after).
5. Driver reading (`node_modules/postgres/src/connection.js`): a connection
   whose startup/handshake stalls cycles silently — `closed()` returns
   `reconnect()` for the initial query without ever surfacing an error to
   the pool — matching `src/db/postgres.ts`'s documented "~60s windows
   where every new connection hangs", and extending to queued queries on
   established sockets once a burst exceeds the warm pool.

Reinterpretation of the original reproduction: the recon run's pool-5 hang
and today's cert failures share this shape — a dashboard navigation fires
~10–12 concurrent RSC renders (sidebar prefetches, the needs-human poller,
the document itself) whose queries exceed the warm pool, the surplus queues,
and the queue wedges. `PG_POOL_MAX=20` passed yesterday because the burst
then fits one-query-per-socket and nothing queues. The 8-read `Promise.all`
was the most visible oversubscriber, but the batching criterion (≤ 4) does
not remove the wedge: the queued-burst defect stands on its own.

**Decision needed (why needs-triage)** — the cert gate needs one of:
(a) investigate a postgres.js upgrade (3.4.9 → current) against this pooler,
    a dependency change that needs an explicit go-ahead;
(b) characterize the hosted pooler's connection limits/timeouts (Supabase
    project settings, outside the repo);
(c) a ticketed app-level countermeasure (e.g. bounding pool queue depth);
(d) re-verify cert70 at pool 5 in a healthier pooler window — the behavior
    varied measurably across this session (35–40-query bursts succeeded
    early, 16 wedged later), so timing may matter as much as code.
Options are not mutually exclusive; (a) is the highest-information next
step. The pre-fix cert repro ("never finished in 90 s") still does not
reproduce *for the settings reads* — the page renders in ~1 s on warm
sockets — but the navigation as a whole cannot be certified while the pool
wedge exists.

**Cleanup record (hosted test project, verified by re-inspection)**: both
aborted cert70 attempts restored the captured settings rows via cert70's
own `finally` (re-verified: `embed_allowlist` exactly
`["https://springfieldcollege.ca"]`, branding rows absent, no other
settings rows left). The disposable `cert-recon` owner is fully removed:
auth user `1c31a775…` deleted through the admin API, its staff row and its
5 `login_events` rows deleted by SQL. `analytics_seen`/`analytics_daily`/
`login_ip_blocks` unchanged from pre-run state; audit_log empty. Two
pre-existing staff-row-less auth user leftovers (`6c1111cb…`, `d0d9ddbc…`,
both created 2026-11-18, predating yesterday's run) remain untouched, as
does the real owner's identity. Note: two owner-identity Auth sessions
created mid-run (21:29/21:37 UTC) were **not** created by anything in this
session (every credential this session used was cert-recon's) — likely a
concurrent session or the user; left untouched. The cert server was
stopped, port 4388 released, LOCALHOST.md updated.
