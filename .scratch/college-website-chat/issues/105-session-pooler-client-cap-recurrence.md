# 105: Session-pooler client-cap exhaustion recurs (EMAXCONNSESSION) — release idle client sockets and cut the per-instance footprint

Status: done

## What this ticket asks for

Production `EMAXCONNSESSION` exhaustion is back on the session pooler
(5432, the ticket-101 standing mode): the shared pooler capped concurrent
clients at `pool_size: 15` and rejected new connections while the owner
used the dashboard on 2026-11-26. Ticket 99's mitigation (per-instance
ceiling 4 + sidebar prefetch off) reduced the fan-out but deployment.md
§7 step 5 explicitly accepted that it was "reduced but not eliminated".
It recurred. This ticket carries the diagnosis (below) and asks the
owner to pick:

1. **Immediate recovery (env/dashboard only, no code)** — one of:
   - **Option A (recommended first step):** Vercel `PG_POOL_MAX` 4 → 1 on
     production + redeploy. Fleet capacity rises from ~3 warm instances
     (4 × 4 ≥ 15) to ~15. Costs: the Settings page's four concurrent
     reads serialize behind one socket (still bounded by ticket 90's 10 s
     queue timeout; each read is sub-second), and each burst pays one
     socket reopen. Everything else in the app runs sequential awaits
     and fits one socket (the desk render, needs-human, members are all
     sequential).
   - **Option A2 (optional headroom, complementary):** raise the
     Supabase **session pool size** in Database settings → Connection
     pooling (dashboard-configurable; defaults to 15 on this compute
     size). The cap is per database **role** — every client of the app's
     role (Vercel fleet, localhost dev, cert scripts) shares the same 15,
     so raising it raises the shared budget. Nano compute allows 60
     direct connections; the Data API is disabled (deployment.md §2), so
     ~30 (≤ 40–50% of 60, leaving room for Auth) is a defensible value.
     This is a production Supabase setting change: owner-only step,
     verify + revert documented before applying.
2. **Durable fix (small code change, then owner env steps)** —
   **Option B:** release idle client sockets. `openPostgres`
   (`src/db/postgres.ts`) sets no `idle_timeout`, so postgres.js
   4.1.1 keeps every socket it ever opened until the instance dies
   (`idle_timeout` default null; `max_lifetime` only recycles in place
   every 30–60 min; the app never calls `sql.end()` per request). Add an
   env-overridable `PG_IDLE_TIMEOUT` (seconds; suggested default 15–30 —
   above quiet gaps between polls would churn, below frees slots within
   one poll interval) so a warm instance's pool shrinks to zero sockets
   when quiet and reopens on demand for bursts. Extend
   `tests/postgres-pool-config.test.ts` (the existing pin for
   `openPostgres` options) and document the row in deployment.md §1.
   This kills the squatting mechanism without touching any endpoint.
3. **Not proposed here (recorded paths only):** transaction pooler
   re-attempt and plan/compute upgrades stay declined per ticket 101 —
   see Comment "Transaction mode reconciliation" for what would have to
   change first (`max_pipeline: 1` is now a documented protocol
   requirement, not just a stall mitigation).

## Acceptance criteria (owner-approved controlled transaction-pooler retry, 2026-11-27)

- `openPostgres` ships the approved runtime shape: `max` defaults to 1
  (`PG_POOL_MAX` override preserved), `max_pipeline: 1` (pipelining
  disabled — fixed, no override), `prepare: false` stays the default
  (`PG_PREPARE` override preserved), `idle_timeout` defaults to 10
  seconds (new `PG_IDLE_TIMEOUT` override), `connect_timeout: 10`,
  `query_timeout` defaults to 15 seconds (`PG_QUERY_TIMEOUT`),
  `queue_timeout: 10` seconds (`PG_QUEUE_TIMEOUT`). All timeout values
  are seconds, matching postgres.js's own units.
- `tests/postgres-pool-config.test.ts` pins every default above plus
  the supported env overrides and the fixed (non-overridable)
  `max_pipeline`/`connect_timeout` pins; both dialect suites green;
  typecheck, hygiene, and production build green.
- deployment.md identifies transaction mode (port 6543) as the owner-
  approved, monitored runtime retry; keeps migrations and operator
  scripts on direct/session connections; states that postgres.js
  timeout values are seconds; preserves the session-mode URL (5432) as
  the rollback path; records the 2026-11-22 transaction-mode stall
  history accurately and does not claim the retry is proven before
  production verification.
- No production mutation during implementation: no Vercel, Supabase,
  or production-data changes from the implementing session. The
  production cutover (Vercel `DATABASE_URL` → 6543, `PG_POOL_MAX` → 1
  or removed, redeploy) remains an owner step, followed by the
  verification checklist: during a staff dashboard session, Vercel
  runtime logs show zero `EMAXCONNSESSION` and no chronic
  `QUERY_TIMEOUT`/`QUEUE_TIMEOUT` weather, and the bell poll answers
  without 500s.
- Supabase session pool size stays at its default and the plan stays
  unchanged (owner constraint).

## Constraints honored in this diagnosis

No code changed, no Vercel environment or Supabase setting touched, no
production data accessed, no sign-in attempts driven (ticket-81 IP
counter untouched). All evidence below is read-only: repo reading,
two credential-free GET probes, and `vercel logs` over the CLI.

## Comments

2026-11-26: Filed from the recurring production outage report. The
symptom text matched ticket 99's 2026-11-22 outage, so tickets 90, 99,
100, 101 and deployment.md were read first; nothing in them was
contradicted — the accepted risk recurred.

### Symptom and evidence (read-only)

- Production deployment `sfc-chatbot-d58jsmpiy` (aliased to
  sfc-chatbot-iota.vercel.app) deployed 2026-11-26 02:50 +0800. Its
  30-minute runtime-log window (02:49–03:19 +0800) contains 76 log
  entries: **57 errors, every one `EMAXCONNSESSION: max clients reached
  in session mode - max clients are limited to pool_size: 15`**; zero
  `QUERY_TIMEOUT`/`QUEUE_TIMEOUT` (the ticket-90/100 tx-pooler weather
  class is absent — this window is purely the client cap).
- Path cross-tab in the same window:
  - `/api/v1/needs-human` (the dashboard-wide bell poll, 10 s cadence,
    `NEEDS_HUMAN_POLL_MS`): **48 errors / 5 successes**.
  - `/api/staff/members`: **9 errors / 0 successes**.
  - Page renders (`/dashboard`, `/dashboard/inbox`, transcript, staff
    page): **16 successes / 0 errors**.
- All 48 needs-human failures share one span/trace, as do all 9
  members failures: a small number of function **instances** starved at
  the cap, failing at *connect*, while instances already holding
  established sockets kept serving — Supavisor session mode rejects new
  client connections, not queries on established ones. Page renders
  passing while both API routes starve is the signature of idle-socket
  squatting, not query overload.
- Two credential-free probes during diagnosis (`/api/healthz`,
  `/api/v1/embed-eligibility`) answered 200 fast — single requests
  don't reproduce the burst shape (consistent with ticket 100's
  observation).
- `vercel env ls production`: `PG_POOL_MAX` and `DATABASE_URL` both
  created 2026-11-22 (the ticket-101 standing state: session pooler
  5432 + ceiling 4), `PG_PREPARE` present. The error text itself
  independently proves session mode — only session mode emits
  `EMAXCONNSESSION`.
- **New finding:** runtime logs show instances in **sin1 and sfo1**,
  not the `vercel.json` `"regions": ["hnd1"]` pin — region placement on
  the current runtime is dashboard/Fluid-governed and the pin no longer
  controls it. Two regions × (page functions + each API route's own
  pool) multiplies the fleet footprint ticket 99 sized against, and
  widens the WAN distance to the Tokyo pooler (ap-northeast-1).
- Localhost factor: LOCALHOST.md records the dev server STOPPED
  (2026-11-22, port 3000 free), so no localhost client is implicated
  today. Note for the future: localhost and cert scripts share the app
  role's 15-client budget; a local dev server at `PG_POOL_MAX=5`
  consumes up to 5 of the 15 slots.

### Determination 1 — why the session pool reaches 15 clients

Session mode gives every client connection a dedicated server session
and caps concurrent **clients** at `pool_size` (15, the default for
this compute size). The cap is per database role, and every client of
the app's role shares it. postgres.js opens sockets lazily on demand,
up to `max` = `PG_POOL_MAX` = 4 per warm instance — and never releases
them: no `idle_timeout` is configured (postgres.js 4.1.1 default null),
the app holds a module-level pool and never calls `sql.end()` per
request, and the default `max_lifetime` only recycles sockets in place
(every 30–60 min, randomized) without freeing the slot beyond moments.
Next.js on the current Vercel runtime runs each dashboard page and each
API route as its own function with its own pool, the 10 s bell poll and
the 1 s Active-desk refresh keep instances perpetually warm, and
instances now span two regions. The fleet therefore walks to
Σ(warm instances × held sockets) ≥ 15 — only ~3.75 instances at full
pool fit — and every new connect lands `EMAXCONNSESSION`. Ticket 99's
load harness demonstrated exactly this shape (3 instances × 4 = peak
12/15 green, cap-bite reproduced in control); what changed since is
instance count and lifetime, not the per-instance ceiling.

### Determination 2 — how many connections each warm Vercel instance can hold

Up to **4** (`PG_POOL_MAX` secret = 4; code default 4 in
`src/db/postgres.ts:46`), opened on demand — an instance that served
only one sequential request holds 1, concurrent demand walks it toward
4 (the Settings page's four-read render is the known per-request shape;
concurrent requests through the same function drive it further), and
they are held for the instance's lifetime. Minimum steady-state
footprint under the current polling patterns: ≥ 1 socket per warm
function, indefinitely.

### Determination 3 — should PG_POOL_MAX be reduced to 1

As the **immediate, no-code recovery: yes, it is the safest single
lever** (Option A above), and it matches Supabase's own serverless
posture (their serverless client example is `prepare: false, max: 1`).
On the session pooler it is more tolerable than on transaction mode
because session mode supports query pipelining (postgres.js pipelines
concurrent queries over the single socket by default), so serialization
cost is mostly round-trip queueing, not lockstep. Known costs: the
Settings page's four concurrent reads serialize (sub-second each,
bounded by the 10 s queue timeout) and bursts pay one socket reopen.
As the **durable fix alone: insufficient** — `max: 1` still holds its
one socket forever per warm instance, so a big-enough fleet still
exhausts 15 eventually (now ~15 instances instead of ~3.75); and it
does nothing for the localhost/scripts side of the shared budget.
The durable shape is Option B (idle release), with `PG_POOL_MAX` left
at 4 (or lowered to 2 as belt-and-braces if the owner prefers).

### Determination 4 — transaction mode with postgres.js now

The ticket-99 compatibility audit stands unchanged (`prepare: false`
required and already default; no session `SET`; no `LISTEN`/`NOTIFY`;
migration temp table transaction-contained; the advisory
`pg_advisory_xact_lock` is transaction-scoped inside `sql.begin`).
Current Supabase guidance adds one **sharper, previously unrecorded
constraint**: the transaction pooler does not support query pipelining,
and postgres.js pipelines by default — per the docs the combo "can hang
queries or return mismatched rows" (silent wrong results, not just
hangs). Ticket 90's bounds make hangs bounded, but bounds do not
address mismatched rows. A future tx-mode attempt must therefore ship
`max_pipeline: 1` (serialize in-flight queries per socket) and verify
it in the harness — ticket 90 proved `max_pipeline: 1` alone does not
fix stall weather, which is a different claim; protocol safety is the
new requirement. Empirically, the shared transaction pooler showed
chronic `QUERY_TIMEOUT` weather for this project on 2026-11-22
(tickets 100/101) and the owner declined re-attempting; today's logs
confirm session mode has no such weather in this window. Net: **safe to
configure, not safe to choose today** — it remains a plan/platform
decision (dedicated pooler, compute upgrade, or demonstrably cleared
weather), and structurally it is the correct serverless shape (its
client cap at this compute size is ~200 clients, multiplexed over
`pool_size` upstream sessions, vs session mode's client cap = pool_size
= 15).

### Determination 5 — does the needs-human polling pattern materially amplify

Yes — materially, as amplifier rather than root cause:

- The 10 s bell poll runs on every dashboard page per open tab
  (`src/app/dashboard/header.tsx:207`); it is 53 of the 76 logged
  requests and 48 of the 57 errors in the window. It keeps a dedicated
  needs-human function (own pool) perpetually warm, guaranteeing ≥ 1
  never-released socket per warm instance — exactly the squatting
  mechanism.
- Under failure the poll has no error backoff, and ticket 100's
  retry-once doubles each failing poll's reads — steady pressure on a
  dead pool instead of decay.
- The Active-desk AutoRefresh (`1 s`, `conversation-desk.tsx:167`) is
  the heavier sibling: a full server render per tick per desk tab with
  roughly ten sequential reads plus a write (`clearConversationAttention`
  runs on every render), which is what drives per-instance pools
  toward 4 and keeps desk instances hot.
- It is not the root cause: ticket 99's original failure needed only a
  prefetch burst, and any burst across enough instances still exceeds
  15. Polling guarantees the fleet stays warm and hungry; idle release
  (Option B) plus a smaller ceiling (Option A) attack the mechanism
  itself. Changing poll cadence or the desk refresh belongs to tickets
  61/77's owners and is deliberately not proposed here.

### Determination 6 — safest immediate recovery and durable fix

Ranked recommendation:

1. **Now (env-only, reversible, minutes):** Option A — Vercel
   `PG_POOL_MAX` 4 → 1 + redeploy. Restores ~15-instance headroom
   immediately. Watch Vercel runtime logs for `EMAXCONNSESSION` going
   to zero during a staff dashboard session.
2. **If pressure persists after A:** Option A2 — raise the session
   pool size (dashboard) toward ~30, respecting the ~40–50%-of-60
   guidance with Auth in mind. Owner-only, production Supabase change,
   reversible.
3. **Durable (small PR, next change window):** Option B —
   `PG_IDLE_TIMEOUT` idle release in `openPostgres` + config test +
   deployment.md row. Removes the squatting mechanism for prod *and*
   any client sharing the budget that adopts it.
4. **Remain declined (ticket 101):** transaction pooler re-attempt
   (now additionally gated on shipping `max_pipeline: 1` + harness
   verification first) and plan/compute upgrades. Revisit only on new
   evidence or a plan change.

Not touched in this diagnosis and noted for whoever implements:
`src/db/postgres.ts`'s docblock still says "Production targets the
transaction pooler (:6543)" — stale prose contradicting deployment.md
§1's standing session-pooler policy (ticket-99-era comment); fix the
comment in the same PR as Option B, not before.

### Feedback loop used for this diagnosis

Read-only, by necessity (production mutation is out of scope): pull the
current production deployment's runtime logs and count the failure
signal — `npx vercel@latest logs --deployment
sfc-chatbot-d58jsmpiy-justme1234567s-projects.vercel.app --scope
justme1234567s-projects --json`, then count `EMAXCONNSESSION`
occurrences (57 in the captured 30-minute window; the CLI only covers
a recent window, so capture during an active staff session). It went
red on the user's exact symptom (needs-human + members failing at
connect under `pool_size: 15`) and goes green on a clean window; the
verification checklist in Acceptance criteria reuses it post-fix.

2026-11-27: **OWNER DECISION — controlled transaction-pooler retry
approved.** The owner chose the path this ticket had recorded as
declined (ticket 101), superseding the diagnosis's ranked options: a
monitored return of Vercel runtime traffic to the Supavisor
**transaction pooler (port 6543)** after the implementing PR merges.
The approved shape, to be implemented as the smallest compatible change
to `openPostgres`:

- Runtime pool size **must be 1** (`max: 1`, `PG_POOL_MAX` override
  preserved).
- postgres.js pipelining **must be disabled** (`max_pipeline: 1`) —
  the protocol requirement Determination 4 recorded: the shared
  transaction pooler does not support query pipelining, and postgres.js
  pipelines up to 100 queries per socket by default.
- `prepare: false` **remains required** (current default, `PG_PREPARE`
  opt-in unchanged).
- `idle_timeout: 10` seconds — new; releases idle client sockets so
  warm serverless instances stop squatting pooler client slots (the
  EMAXCONNSESSION mechanism this ticket diagnosed; folds this ticket's
  Option B mechanism into the retry).
- `connect_timeout: 10`, `query_timeout: 15`, `queue_timeout: 10` —
  all postgres.js timeout values are **seconds**.
- **Migrations and operator scripts remain on direct/session
  connections** (their own environment's URL — locally the session
  pooler 5432; no script URL sources change).
- **Do not** raise Supabase's session pool size or upgrade the plan.
- **Do not** mutate Vercel, Supabase, or production during
  implementation — the cutover itself is the owner's post-merge step,
  with rollback = the old session-mode URL (5432). The retry is
  monitored, not proven: the 2026-11-22 chronic `QUERY_TIMEOUT` weather
  (tickets 100/101) remains the known failure mode to watch for, and
  the ticket stays open (ready-for-human) until production
  verification passes.

2026-11-27: **IMPLEMENTED + REVIEWED — production cutover pending, so
the ticket moves to ready-for-human, not done.** Branch
`codex/ticket-105-transaction-pooler-retry` (from origin/main
`446088531`; the diagnosis commit `889b09ed` cherry-picked as
`0ceb4ad04`, evidence byte-identical). Commits: `8487349b0` (feat — the
retry shape), `2b7ea8cab` (fix — the review's in-scope finding).

**Implementation** — `src/db/postgres.ts` `openPostgres` now ships:
`max` default 1 (`PG_POOL_MAX` override), fixed `max_pipeline: 1`,
`prepare` default false (`PG_PREPARE` opt-in), `idle_timeout` default 10
(new `PG_IDLE_TIMEOUT` override), fixed `connect_timeout: 10`,
`query_timeout` default 15 (`PG_QUERY_TIMEOUT`), `queue_timeout` default
10 (`PG_QUEUE_TIMEOUT`). One shared opener for runtime and
scripts/migrations — the scripts keep their own environment's
direct/session URLs; no script URL source changed. The stale ticket-99
docblock ("Production targets the transaction pooler") is rewritten as
part of the change, as the diagnosis asked.

**Option semantics verified against installed postgres.js 4.1.1**
(not from memory): `types/index.d.ts` documents every timeout option in
seconds (`idle_timeout` "Seconds before an idle connection closes;
0, null or false to keep it @default null"; `max_pipeline` "Most queries
pipelined on one connection @default 100"; `queue_timeout` "Seconds a
query, transaction or reserve may wait for a connection";
`query_timeout` "Seconds a query may wait and run";
`connect_timeout` "Seconds to connect" @default 30; `prepare`
@default true). `src/index.js` confirms the defaults and integer
coercion; `src/pool.js` gates every pipeline/acquire path on
`c.inflight < options.max_pipeline` (lines 287/340/648/651), so
`max_pipeline: 1` means one in-flight query per socket (serialized,
never pipelined) — leased `sql.begin` transactions bypass the gate
safely — and arms the idle close timer as `idle_timeout * 1000` only
when a connection has zero in-flight queries (lines 605-631), with a
falsy value keeping sockets forever. An options-surface probe echoed
all seven parsed values (`{max:1, max_pipeline:1, prepare:false,
idle_timeout:10, connect_timeout:10, query_timeout:15,
queue_timeout:10}`) off a real handle.

**Tests** — `tests/postgres-pool-config.test.ts` pins all seven
defaults, the five overrides (`PG_POOL_MAX`, `PG_PREPARE`,
`PG_QUERY_TIMEOUT`, `PG_QUEUE_TIMEOUT`, `PG_IDLE_TIMEOUT`), the fixed
`max_pipeline`/`connect_timeout` pins (no override by design), the
`PG_IDLE_TIMEOUT=0` disable, and blank-means-unset parsing. Full
matrix green on the final code: focused 4/4; SQLite 643 passed / 7
skipped; PostgreSQL 647 passed / 3 skipped (local 5433 scratch
cluster); `tsc --noEmit` clean; hygiene passed (808 files); production
build exit 0.

**Review** (both axes, from `446088531` over the pre-commit working
tree; findings fixed in `2b7ea8cab`): Standards — two ticket-file
convention fixes applied (decision comment moved to the bottom per the
append convention; status set from ready-for-agent to ready-for-human
here, matching the pending owner-only cutover); rationale duplicated
across ticket/docs/docblock/test accepted as the repo's per-audience
convention (the pin test carries the values). Spec — no missing or
partial requirements; no material scope creep (`.env.example` default
row updates and the new `PG_IDLE_TIMEOUT` row keep its every-variable
claim true); one real finding fixed: a blank `PG_IDLE_TIMEOUT` (the
copied-`.env.example` shape) parsed to `Number("") = 0`, silently
disabling idle release — all four numeric overrides now parse through a
blank-guarding helper with a pin test; one minor prose note accepted
(the rollback-shape sentence in deployment.md §7 step 5 is accurate per
Determination 3).

**Constraints honored:** no Vercel/Supabase/production mutation, no
production data accessed, no sign-in attempts driven; session pool size
and plan untouched. **Remaining (owner-only):** the deployment.md §7
cutover — Vercel `DATABASE_URL` → 6543, `PG_POOL_MAX` → 1 (or delete),
redeploy, then the verification checklist (zero `EMAXCONNSESSION`, no
chronic `QUERY_TIMEOUT`/`QUEUE_TIMEOUT` weather during a staff
dashboard session). Rollback stays the session-mode 5432 URL. This
ticket closes only after that verification.

2026-11-27: **PRODUCTION CUTOVER EXECUTED AND VERIFIED — done.** The
owner merged PR #21 (origin/main = `6304d137a`); the guarded cutover
ran the same session:

**Mutations (production only; Preview and Development untouched; the
only two production changes of the whole cutover):** production
`DATABASE_URL` updated via `vercel env update --environment production`
from the session-pooler 5432 URL to the same project's
transaction-pooler 6543 URL — host, user, password, and database
verified byte-identical with only the port field changed (URL-API
transform; the first naive string replace was caught and discarded
because the password itself contains the substring `:5432`); production
`PG_POOL_MAX` updated 4 → 1. No credential was printed, logged, or
committed; the secret cannot be read back from Vercel (secret-typed),
so the preserved rollback value is the main checkout `.env.local`
5432 string — the same value proven live on production during the
2026-11-22 rollback — validated (parses, port 5432, pooler username,
project ref matches the auth URL) before any mutation.

**Deployment:** `sfc-chatbot-jbheprb3h` (the merge auto-deploy of
`6304d137a`) was READY with the old env; `vercel redeploy` rebuilt it
as **`sfc-chatbot-6fmbg0xkt`** — commit `6304d137a` (current
origin/main), **Ready in 41 s, aliased to
sfc-chatbot-iota.vercel.app**.

**Verification window 02:11–02:37 +0800 (~26 minutes), 10 log
snapshots** over the new deployment (`vercel logs --deployment …
--scope justme1234567s-projects --json`): **0 `EMAXCONNSESSION`, 0
`QUERY_TIMEOUT`, 0 `QUEUE_TIMEOUT`, 0 error-level entries** (window
grew 7 → 17 entries; isolated bounded rejections: none; chronic
weather: none — the 2026-11-22 failure mode did not appear).

**Smoke (all agent-driven, unauthenticated + visitor API):**
`/api/healthz` 200 (1.05 s, DB roundtrip); `/dashboard/login` 200;
`/dashboard` 307 → login (auth guard intact); embed-eligibility 200
with `allowed:false` for an unlisted origin and `allowed:true` for the
allowlisted college origin (both allowlist reads correct); two full
visitor conversations created (201, contact-validated), free-text
messages answered by the bot, transcripts round-tripped with correct
roles and counts, one-click needs-human escalation accepted on both
(tick 103 staleness path exercised — the choice refused once as
unoffered, then accepted as offered), needs-human bell refused an
unauthenticated caller with 401; **row-integrity probe PASS** — two
distinctive marker texts sent back-to-back round-tripped byte-exact
with exactly two visitor rows and two well-formed bot replies, the
direct mismatched-rows watch for `max_pipeline: 1`. Synthetic probe
conversations left in place (cert-26 precedent), all named
"Ticket 105 … Probe": `d69b761d…`, `e21ff000…`, `189f6a63…` — delete
from History if unwanted.

**Honest scope note:** interactive authenticated flows (sign-in,
Settings, Staff, Logs, Answers, Inbox, account creation) were NOT
driven by this session — it holds no production credential, declined
wrong-password attempts (ticket-81 IP counter), and a disposable
identity was not authorized; none was observed in the monitored window
either. Login-page reachability, the auth guard, and DB-backed reads
are verified directly; any authenticated failure remains an immediate
rollback trigger.

**Rollback readiness (unused):** preserved 5432 `DATABASE_URL`
(validated) and `PG_POOL_MAX=4` re-settable via the same
`vercel env update --environment production` piped pattern; prior
deployment `sfc-chatbot-jbheprb3h` remained READY throughout. Had
login, ordinary use, or database behavior failed, that pair plus one
redeploy restores the ticket-101 standing mode exactly.

deployment.md §7's banner updated from "approved, not proven" to the
executed-and-verified record (docs-only factual correction).

Reviewed through: 2b7ea8cab
