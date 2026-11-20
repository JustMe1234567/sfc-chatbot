# 90: postgres.js/Supabase transaction-pooler burst traffic permanently wedges the application pool

Status: done

## What to build

Ticket 89's blocked cert criterion isolated a deeper defect: on
postgres.js 3.4.9 against the Supabase transaction pooler (:6543) with the
app's pool options (`max` 5, `prepare: false`, `connect_timeout: 10`), a
parallel burst of queries larger than the warm pool leaves the client-side
pool **permanently wedged** — every later query, even single sequential
ones, hangs forever with no error, while `pg_stat_activity` shows the
server side idle. Ticket 89's decision point options (a)+(b)+(c) rolled
into a diagnosis ticket:

- Compare postgres.js 3.4.9 (current) against current 4.1.x on this pooler
  with a differential harness (same bursts, both drivers).
- Test the hosted test project's transaction pooler **and** the
  session-pooler / direct endpoints where available.
- Evaluate `query_timeout` as a bound so a wedged pool cannot persist.

Do **not** modify the application dependency until the differential
harness proves the correct fix. Do not touch production.

## Acceptance criteria

- Burst traffic cannot leave the pool permanently wedged.
- A subsequent single query completes or rejects within a fixed bound.
- cert70 passes with `PG_POOL_MAX=5` against the hosted test project.

## Comments

2026-11-20: Filed from ticket 89's decision point (option (a) recommended
there). Evidence inherited from ticket 89: `.scratch/cert89-bare-probe.mjs`
(browser-shaped bursts), `.scratch/cert89-burst-size.mjs` (burst threshold;
in that window 8 clean, 16 wedged), `.scratch/cert89-activity.mjs`
(pg_stat_activity through the pooler), driver reading of
`node_modules/postgres/src/connection.js` (`closed()` → silent
`reconnect()` cycle for the initial query).

2026-11-20: **DIAGNOSED + FIXED (dependency change authorized by the
harness per the ticket's own gate). All three acceptance criteria pass.**

### Root cause (two layers)

1. **Environmental trigger — the transaction pooler endpoint.** Under
   multi-socket concurrent load the Supabase transaction pooler
   (`aws-0-ap-northeast-1.pooler.supabase.com:6543`) intermittently stops
   answering queries on *established* client sockets while the server side
   stays idle (ticket 89's `pg_stat_activity` evidence), and in congested
   windows it also stalls new handshakes. The **session pooler** (:5432)
   never exhibits either behavior: identical driver, identical bursts, same
   minutes-wide window — 48-query bursts complete in ~120 ms with all
   sockets idle afterwards, twice, on both driver versions. The **direct
   endpoint is unavailable**: `db.<ref>.supabase.co` does not resolve from
   this network (ENOTFOUND).
2. **Client amplifier — no bound on in-flight queries.** postgres.js (3.4.9
   AND 4.1.1, unbounded) assigns each query to a socket and waits forever;
   a stalled query holds its lease permanently, every socket ends up stuck
   in-flight, the queue fills behind it, and no error ever surfaces. 4.1.1's
   rewritten pool made this directly observable via `sql.stats`: mid-wedge
   the pool reports `connections:5, opening:0, idle:0, leased:0,
   waiting:0` while 8+ queries never settle — the queries are stuck
   *assigned to sockets*, not queued. 3.4.9 additionally cycles
   `closed()` → `reconnect()` silently for the initial query (ticket 89's
   driver reading), and has no `query_timeout`/`queue_timeout` at all.

### Differential harness (the feedback loop)

`.scratch/t90-harness.mjs` — the cert89 bare-process reproduction
parameterised across driver version (3.4.9 / 4.1.1, the 4.x copy installed
in `.scratch/pg41/`), endpoint (tx / session / direct), bound options, and
load shape (single-query bursts and app-shaped renders incl. abandoned
RSC-style consumers), always ending with sequential pool-health probes.
Verdict WEDGE = any health probe hangs. ~2 min per cycle, zero secrets
printed. Results (tx = transaction pooler :6543, session = :5432):

| driver | endpoint | bounds | result |
| --- | --- | --- | --- |
| 3.4.9 | tx | none | **RED ×3** — bursts wedge, health hangs past 30 s, zero errors; burst 8 wedged in the worst window (3/8 hung) |
| 3.4.9 | tx | none | one green run (small bursts in a momentarily healthy window — the trigger is window-dependent) |
| 3.4.9 | tx | `max_pipeline: 1` | still RED at burst 16 — sockets stop answering mid-stream, not a pipelining-only defect |
| 3.4.9 | session | none | GREEN ×2 cycles, 48-bursts ~120 ms |
| 4.1.1 | tx | none | **RED** — wedges identically; `sql.stats` shows the stuck-assigned state (idle 0, waiting 0) |
| 4.1.1 | tx | `query_timeout: 10` + `queue_timeout: 10` | **GREEN** — stalled queries reject with `QUERY_TIMEOUT` at the 10 s bound, canceled sockets are destroyed (cancel_timeout 5 s), pool opens fresh sockets and health recovers |
| 4.1.1 | session | none | GREEN ×2 cycles |
| 4.1.1 | session | bounds | GREEN ×2 cycles incl. full render mode (12 app-shaped renders in ~400 ms, zero rejections) |
| both | direct | — | N/A — host does not resolve (ENOTFOUND) |

Full render mode on tx with bounds stayed green across two cycles even in
a badly degraded window (zero hangs; heavy bounded rejections) — proving
the bound alone satisfies AC 1 and AC 2 on the bad endpoint. The session
pooler additionally makes everything complete cleanly, which is what the
cert gate needs.

### Fix shipped (the harness-proven dependency change)

- `package.json`: `postgres` `^3.4.9` → `4.1.1` (exact). The app's driver
  surface (`openPostgres`, `unsafe`, `begin`, `end`, types) is fully
  compatible; the relevant 4.x additions are `query_timeout`,
  `queue_timeout`, `cancel_timeout`, and per-query deadlines.
- `src/db/postgres.ts` `openPostgres`: `query_timeout:
  PG_QUERY_TIMEOUT ?? 10`, `queue_timeout: PG_QUEUE_TIMEOUT ?? 10`
  (seconds, env-overridable; 10 s is far above warm query times and far
  below the hosted statement timeout), with the ticket-90 mechanism
  documented in the comment.
- `.env.local`: `DATABASE_URL` switched from the transaction pooler :6543
  to the **session pooler :5432** (same credentials) — the endpoint the
  harness proves clean, and the one production has used since 2026-11-19.
  `PG_PREPARE=false` and `PG_POOL_MAX=5` unchanged.
- `docs/deployment.md`: `DATABASE_URL` row now names the session pooler
  and why; new `PG_QUERY_TIMEOUT` / `PG_QUEUE_TIMEOUT` rows.

### Regression test (`tests/postgres-pool-bounds.test.ts`)

A correct seam exists after all: the file fronts the real test Postgres
with a local TCP proxy that relays the handshake + one warmup query and
then silently swallows every further client→server byte (the "silent
endpoint" the transaction pooler produces), drives `openPostgres` through
it, and asserts a single query and an 8-parallel burst all **reject within
the bound** instead of hanging. Deterministic on loopback, PG-gated
(skips on SQLite like the other PG-mode files). Watched it fail on 3.4.9
(`"HUNG"` at the race — the exact user symptom) before applying the fix,
then pass on 4.1.1 (rejection ≈ 2 s timeout + 5 s cancel + margins). The
in-repo seam can't prove hosted-pool *recovery* (the proxy is dead by
construction) — that part is the harness's health probes.

### Test-environment note

The full PG suite's provisioning burst (68 workers × CREATE DATABASE +
migrations on one local cluster, ticket 83) legitimately exceeds a 10 s
statement bound under full parallel contention, so `tests/helpers.ts`
relaxes `PG_QUERY_TIMEOUT`/`PG_QUEUE_TIMEOUT` to 60 s for the test
environment only (`??=` — the app default 10 s stands, and the bounds
behavior is pinned by the new test with 2 s values). First suite run at
10 s failed 9 files with `QUERY_TIMEOUT` cancels; every one passes alone
and all pass with the relaxed test bound.

### Verification

- Focused bounds test: RED on 3.4.9 → GREEN on 4.1.1+bounds.
- Full suite: Postgres **581 passed / 3 skipped** (ticket 89's 580 + the
  new test), SQLite **577 passed / 7 skipped** (577 + the new test
  skipping).
- `npm run check` green end to end (hygiene, typecheck, suite, production
  build) on 4.1.1.
- **cert70 PASSED at `PG_POOL_MAX=5`** — local production runtime on
  127.0.0.1:4388, `DATABASE_URL` = hosted test project via the session
  pooler, driver 4.1.1 + bounds (log `.scratch/t90-cert70.log`, exit 0,
  "ticket 70 checks passed", **zero** `QUERY_TIMEOUT`/`QUEUE_TIMEOUT`
  events during the entire browser-driven run, settings rows restored
  byte-identically by the cert's own `finally` and re-verified:
  `embed_allowlist` exactly `["https://springfieldcollege.ca"]`, branding
  rows absent). The criterion that blocked ticket 89 twice (navigation
  hung >90 s at pool 5 on :6543) passes cleanly.
- Production untouched: no Vercel deploy, no production-data access. The
  Vercel test project will pick up the driver change at its next deploy;
  its `DATABASE_URL` already points at the session pooler.

### Cleanup record (hosted test project, verified by re-inspection)

The disposable `cert-recon` owner is fully removed: auth user `60f613c4…`
(`1717507f-473a-4ad6-8b58-40a62ad13105@staff.invalid`) deleted through the
admin API (HTTP 200), its staff row and its 1 `login_events` row deleted
by SQL; `staff_members` back to only the real `owner`; settings keys
exactly the pre-run four (`embed_allowlist`,
`escalation_phrases`, `handoff_options`, `transcript_retention_days`).
The two pre-existing 2026-11-18 synthetic auth users ticket 89 noted
remain untouched, as does the real owner's identity. Cert server stopped,
port 4388 released, LOCALHOST.md updated. `analytics_*`, `login_ip_blocks`,
`audit_log` untouched.

### Status

Diagnosis complete, fix shipped and certified. `Status: needs-triage`
until the user reviews the dependency bump (postgres.js 3.4.9 → 4.1.1 is
a major-version jump; the suite and cert70 both validate it, and ticket
89's decision point recommended exactly this upgrade). If approved as-is,
this ticket can close and ticket 89's blocked AC is unblocked.

2026-11-20: **Dependency change approved; ready for human review.** The
owner approved the exact postgres.js 4.1.1 upgrade and the harness-proven
query/queue bounds after reviewing the differential evidence, both-dialect
suites, production build, and cert70 result. Ticket 89 is unblocked and
records its previously blocked criterion as passing. No production deploy
or production-data operation was performed as part of this approval.

2026-11-20: **Review amendment — one actionable finding fixed.** A
`/code-review 9ea8fcacc` rerun over the range including this ticket's
commits (5e4df8391, 707bb7c97) found no hard standards violations on
either axis. Recorded findings and their dispositions:

- **FIXED — environment leak in `tests/postgres-pool-bounds.test.ts`:**
  the test set `PG_QUERY_TIMEOUT`/`PG_QUEUE_TIMEOUT` to their 2 s values
  and never restored them, so vitest worker state could inherit a 2 s
  bound and flake later PG work with exactly the QUERY_TIMEOUT cancels
  the `tests/helpers.ts` relaxation exists to prevent. The test now
  captures each variable before overriding and restores the original
  value — deleting the variable if it was originally absent — in a
  `finally` that runs even when the test fails. Timeout assertions and
  application behavior unchanged (`openPostgres` defaults stay 10 s).
  Honest scoping: the repo's current per-file vitest isolation (68
  workers spawned, one per file) already contained the leak; the fix
  removes the dependency on that configuration (vitest's own output
  advertises `isolate: false` as a future speedup that would otherwise
  have exposed it).
- Evidence-class caveats (recorded, not actioned): AC 1's hosted-pool
  *recovery* evidence and ticket 89 AC 2's cert evidence live in
  untracked scratch artifacts (`.scratch/t90-harness.mjs`,
  `.scratch/t90-cert70.log`) because the tracker ignores transient
  scratch files by design; the committed regression test pins bounded
  rejection only, as its comment discloses.
- Scope-creep notes (recorded, sanctioned): the session-pooler endpoint
  switch and the added `queue_timeout` exceed the ticket's literal
  "test the endpoints / evaluate query_timeout" text and are covered by
  the owner's recorded approval above, which names the certified
  session-pooler path and the harness-proven bounds.
- Judgement-call smells from the review (helpers env mutation shape,
  magic numbers in the bound arithmetic, four env reads in
  `openPostgres`, status-label semantics, plus all previously parked
  smells) were deliberately NOT addressed, per instruction.

Verification of this amendment: focused bounds test 1/1 (12.3 s); full
PostgreSQL suite 581 passed / 3 skipped; `npm run check` exit 0
(SQLite 577 passed / 7 skipped, hygiene, typecheck, production build).

2026-11-20: **COMPLETE.** Status set to `done` — a terminal marker outside
the five triage roles (none of which means complete), added per the
owner's instruction. Post-merge production verification:

- **Production deployment reference:** PR #1 merged `codex/supabase-auth`
  (through 2edc487fc) into `main` as 701710c77; Vercel deployed it as
  `sfc-chatbot-brko0x0il` (production, ● Ready, 30 s build, created
  2026-11-20 16:23 +0800, functions in hnd1 — the region queued in
  vercel.json since ticket 86 is now live), aliased to the canonical
  https://sfc-chatbot-iota.vercel.app. The deployed code carries this
  ticket's whole fix: postgres.js 4.1.1 with `query_timeout`/`queue_timeout`
  (10 s defaults) and the session-pooler `DATABASE_URL` production has used
  since 2026-11-19.
- **cert70 success:** passed at `PG_POOL_MAX=5` on the local production
  runtime (exit 0, zero `QUERY_TIMEOUT`/`QUEUE_TIMEOUT` events during the
  entire browser-driven run, settings rows restored byte-identically) —
  the criterion that blocked ticket 89 twice.
- **Smoke-test result (live on -iota, post-merge deployment):**
  `/api/healthz` 200; `/` 307 → `/dashboard`; `/dashboard` 307 → login.
  Password-only login verified at the surface: the login page renders a
  username+password form with zero authenticator/totp/two-factor/enroll
  markers; `/dashboard/enroll` answers 404; `POST /api/auth/two-factor/enable`
  answers 404; the sign-in API answered a single wrong-credential probe
  with 401 `authentication_failed` and the masked generic message — no
  `twoFactorRedirect` shape, no second stage. A full credentialed sign-in
  was not driven: the production owner's password is user-held.
  `/dashboard/settings` and `/dashboard/logs` unauthenticated render the
  designed empty authorized-session shell with zero content leakage.
- **TOTP cleanup (recorded as reported by the owner, corroborated
  read-only):** 2 auth users scanned, 1 verified TOTP factor removed; the
  second pass removed 0. Read-only check of the shared project
  (bmlwasuvujkfchnbklls): `auth.users` = 2, `auth.mfa_factors` = 0 rows.
  The probe wrote 1 `login_events` row (by design); IP counter 1/10, no
  block.
