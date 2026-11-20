# 86: Bound hosted database connection waits

**Status:** ready-for-human  
**Category:** bug (deployment)  
**Priority:** P2  
**Blocked by:** none  
**Related:** [11: Supabase Postgres backend with Vercel deployment path](11-*) — the hosted database this hardens; [80: cert fleet sign-in stale on Supabase branch](80-cert-fleet-sign-in-stale-on-supabase-branch.md) — same underlying connection stalls observed during certification

## Context

On 2026-11-19 the production deployment hit Supabase pooler windows of
roughly 60 seconds where every new PostgreSQL connection stalled. With no
connection-establishment timeout, `postgres.js` waits on the handshake
indefinitely, so a stalled pooler queued the entire serverless application
behind hung connects — requests piled up instead of failing fast and
retrying. This ticket retrospectively records user-authorized reconciliation
work implemented in commit `c5ed6ff93` before the ticket existed.

## Desired behavior

1. Vercel deploys the application in the Tokyo region (`hnd1` in
   `vercel.json`), co-locating the serverless functions with the hosted
   database region.
2. PostgreSQL connection establishment has a bounded timeout:
   `openPostgres` passes `connect_timeout: 10` to `postgres.js`, so a
   handshake that cannot complete within ten seconds is discarded and the
   caller fails fast instead of waiting.
3. A stalled hosted pooler cannot queue the application indefinitely — hung
   connects are bounded, freeing the request to error/retry rather than
   blocking forever.
4. Normal successful database connections and local/test behavior remain
   unchanged: healthy handshakes complete in far less than the cap, and no
   other connection option moves.

## Acceptance criteria

- [x] `vercel.json` sets `"regions": ["hnd1"]` (Vercel's Tokyo region) on
  the deployment.
- [x] `src/db/postgres.ts` `openPostgres` sets `connect_timeout: 10`, with
  the stall behavior documented in the function's doc comment.
- [x] A stalled pooler cannot queue the application indefinitely — the pool
  discards a hung connect after the cap instead of waiting on it.
- [x] No other connection behavior changed in the commit: the pool ceiling
  stays `PG_POOL_MAX ?? 8`, prepared-statement opt-in stays
  `PG_PREPARE === "true"`, and the diff's only other touch is removing one
  blank line in `migratePostgres`.
- [x] Local/test behavior is unchanged — the full PostgreSQL-mode and
  SQLite-mode suites pass on trees containing the commit, exercising the
  same `openPostgres` path with healthy local handshakes under the cap.

## Out of scope

Changing the pool size defaults or `PG_POOL_MAX` handling, adding statement-,
query-, or idle-timeouts, retry/backoff policy, moving the DATABASE_URL
between Supabase pooler types (a deployment-configuration decision outside
the repo), schema or migration changes, and any application behavior beyond
the connection-open options.

## Implementation record

Commit `c5ed6ff93` (2026-11-19, "fix(deploy): bound hosted database
connection waits"): `vercel.json` (+`regions: ["hnd1"]`),
`src/db/postgres.ts` (+`connect_timeout: 10` with the stall rationale added
to the doc comment).

## Comments

2026-11-19: Filed retrospectively — user-authorized reconciliation work
already implemented before the ticket existed; this file records it for
final review. Verification: the committed diff was read and matches every
criterion (region line, the one option, no other connection change); the
full PostgreSQL suite (573 passed / 3 skipped) and SQLite suite (570 passed
/ 6 skipped) ran green on a tree containing the commit during the ticket-83
filing session, and the filing-session `npm run check` (including the
production build and typecheck) covers the changed file compiling. The
~60-second stall observation is the 2026-11-19 production incident this
commit responds to.
