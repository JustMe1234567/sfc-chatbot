# 105: Session-pooler client-cap exhaustion recurs (EMAXCONNSESSION) — release idle client sockets and cut the per-instance footprint

Status: needs-triage

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

## Acceptance criteria (for the eventual fix ticket, Option B shape)

- `openPostgres` releases idle client connections after
  `PG_IDLE_TIMEOUT` seconds (default chosen and justified); burst
  behavior unchanged (sockets reopen on demand; ticket 90's
  `query_timeout`/`queue_timeout` and `prepare: false` untouched;
  `PG_POOL_MAX` unchanged).
- `tests/postgres-pool-config.test.ts` pins the new default and the env
  override; both dialect suites green; `npm run check` green.
- deployment.md §1 gains the `PG_IDLE_TIMEOUT` row (and §7 step 5's
  accepted-risk note is reworded to name the new mechanism).
- Code change rides a normal PR; the owner performs the only
  production steps they choose (env or dashboard), with the ticket's
  verification checklist: during a staff dashboard session, Vercel
  runtime logs show zero `EMAXCONNSESSION` and the bell poll answers
  without 500s.

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
