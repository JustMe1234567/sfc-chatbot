# 100: A transient database failure during session validation masquerades as "unauthorized" on the transaction pooler

Status: done

## What to build

Post-cutover to the transaction pooler (6543, ticket 99's runbook), the
owner signs in successfully — the sign-in POST's DB reads, the Supabase
Auth call, and the success-log DB write all work, and the client redirects
— but the very next request can render "This page requires an authorized
staff session." Server logs on the production deployment
(dpl_AwjbiVWUup4daXxdDHRMuyDJRUa9) show the cause:
`QUERY_TIMEOUT: The query did not finish within query_timeout (10 seconds)`
/ `57014: canceling statement due to user request` (02:20:56 and
02:23:24, digest `3350715011`) — ticket 90's known transaction-pooler
stall class, live again on 6543 and arriving in intermittent windows.

`requireStaff` runs `auth.authenticate(headers).catch(() => null)`: any
throw during session validation — including a bounded pooler stall — is
swallowed and surfaces as "unauthenticated". A stalled
`auth.sessions`/`auth.users` read therefore looks identical to a logged-out
staff member, and every dashboard page server-renders the unauthorized
shell. Incognito and cookie-clearing do not help; the failure is
server-side and intermittent (credential-free DB probes answer cleanly
between windows).

Fix the smallest correct thing: in `src/auth/supabase-provider.ts`'s
`authenticate()`, retry the session-lookup read **once** when the failure
is transient (ticket 90's bounded timeout codes, connection-class
SQLSTATEs, and socket errors). The read is a pure `SELECT` — idempotent
and safe to retry; a fresh socket almost always lands immediately in a
clearing window. Non-transient errors rethrow unchanged; a second
transient failure propagates (requireStaff's swallow then applies only to
a genuinely dead window, where a reload is the honest recovery).

Do not change ticket 90's 10 s bounds, `prepare: false`, `PG_POOL_MAX`,
or any timeout. Do not retry writes anywhere. Do not touch the claims
(Auth-service) path or the sign-in path's DB operations — park both with
rationale.

## Acceptance criteria

- The session-lookup read retries exactly once on a transient failure and
  returns the identity when the retry lands; read called exactly twice.
- Non-transient errors (e.g. a unique-violation-class code) rethrow
  immediately — read called exactly once.
- A second consecutive transient failure propagates — read called exactly
  twice, error surfaced.
- Healthy databases see zero behavior change (no retries, no added
  latency).
- Focused behavior tests cover all four paths; `npm run check` green.
- Ticket 90's bounds and every pool configuration value are unchanged.

## Comments

2026-11-22: Filed urgent from the post-cutover login failure (owner in
the loop; root cause confirmed from production runtime logs — the full
evidence chain is summarized in the ticket 99/101 records). Working branch
`codex/ticket-100-auth-transient-retry` cut from origin/main `4e5f10cc1`
(PR #13 merged: pool ceiling 4 + nav prefetch off are already live in
production).

2026-11-22: **IMPLEMENTED. All acceptance criteria pass.**

### Shipped

- **`src/auth/supabase-provider.ts`** — a new `withTransientDbRetry`
  helper with `isTransientDbError` classification, wired around the one
  session-lookup read inside `authenticate()`. The transient class: named
  driver bounds (`QUERY_TIMEOUT`, `QUEUE_TIMEOUT`, `CONNECT_TIMEOUT`),
  SQLSTATEs `57014` (the bounds' cancellation) and `53300` (pooler
  pressure), the `08xxx` connection-exception class, and socket-message
  errors (ECONNRESET / ECONNREFUSED / EPIPE / ETIMEDOUT / socket hang
  up). Exactly one retry after a 250 ms gap; non-transient errors rethrow
  immediately; a second consecutive transient failure propagates —
  `requireStaff`'s swallow then applies only to a genuinely dead window,
  where reload is the honest recovery. Healthy databases see zero
  behavior change: the read runs once, no added latency.
- **Why inside `authenticate()` and not `requireStaff`:** the provider
  knows which call is a pure read; `requireStaff`'s contract (identity |
  null) and every page's shell branch stay untouched — one seam, no page
  changes, and no write is retried anywhere (double-execution hazard).
- **Honest latency accounting:** a single stall now costs ≈ the 10 s
  bound + 250 ms + one fast retry (a lying 401 shell became a slow-but-
  correct render); a double stall ≈ ~20 s before the swallow — slow,
  never false.

### Parked (rationale recorded)

- **`getClaims()`** (Auth-service HTTPS): no observed weather on that
  path, and supabase-js error shapes are stringly-typed — retrying it
  needs its own classification work. A failed claims check returns null
  honestly today.
- **The sign-in path's DB operations** (staff lookup, login-event
  writes): their failures already surface as the masked "Sign-in failed."
  plus a user retry, and blindly retrying login-event writes is not
  wanted.

### Verification

- Focused: `tests/auth-transient-retry.test.ts` 7/7 — healthy path reads
  exactly once; `QUERY_TIMEOUT` named code retried once and recovered;
  bare SQLSTATE `53300` retried; wrapped-cause `57014` retried;
  `ECONNRESET` message retried; non-transient `23505` rethrown after
  exactly one read; double-transient propagates after exactly two. Plus
  `postgres-pool-config` 2/2 (ticket 90's bounds and the ticket 99
  ceiling unchanged, pinned); `postgres-pool-bounds` skips on SQLite by
  design.
- `npm run check` green end to end (hygiene 790 files, typecheck, 71 test
  files / 609 passed / 7 skipped, production build).
- Production untouched: no deploy, no Vercel environment change; the fix
  rides the next deploy after merge.

### Status

COMPLETE — all acceptance criteria pass. Status set to `done`. PR opened
for review; merge and deploy are the owner's steps.

2026-11-22: **Review amendment — `/code-review 4e5f10cc1` over the full
range (2 commits), both axes. No hard violations on either axis;
in-scope findings fixed, judgement calls parked.**

- **FIXED — connection-class coverage (spec axis):** the set omitted
  `08007` (protocol_violation), the one missing member of PostgreSQL's
  class-08 connection exceptions; added.
- **FIXED — Node socket errnos on `err.code` (spec axis):** system
  errors carry `ECONNRESET`-style codes on `err.code`, which only the
  message regex caught; the errno names joined the transient set, and a
  behavior test pins the errno-as-code path (8/8 now).
- **FIXED — Mysterious Name (standards axis, trivial):** the 250 ms gap
  became the named `RETRY_GAP_MS` constant.
- **PARKED — Duplicated Code in the tests (standards axis):** the five
  retry-and-recover cases share a shape but differ in error
  construction; each documents a distinct classification path, and the
  repo's established preference is explicit named cases over
  test.each indirection (ticket 96's review precedent).
- **PARKED — classification placement (standards axis, Feature Envy
  adjacent):** the DB-code vocabulary lives in the auth provider rather
  than `src/db/`; the ticket scoped the seam to `authenticate()`, so it
  stays until a second caller ever appears (then relocate as its own
  ticket).
- **PARKED — `CONNECT_TIMEOUT` + `53300` in the set (spec axis, creep
  notes):** no connect bound is configured and `53300` exceeds the
  ticket's enumerated class, but both are read-only-retry-safe
  expressions of the same pooler pressure the ticket targets.
- **PARKED — healthy-path latency assertion (spec axis nit):** the
  healthy case asserts one read; "no added latency" is structural (the
  delay only exists on the retry path) and a timing assertion would be
  flaky for nothing.
- **PARKED — `vi.unmock` coupling (standards axis note):** the test
  file must unmock the globally-mocked provider; the same preamble the
  supabase-config test already carries.

Verification of this amendment: focused tests 8/8, typecheck clean, full
`npm run check` green.

Reviewed through: d3399c466bea25ba819b64182880e9f8c1b3e48b
