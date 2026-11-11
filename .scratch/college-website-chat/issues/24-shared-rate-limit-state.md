# 24: Rate limiting must hold across serverless instances

**Status:** ready-for-human
**Priority:** P2 — security blocker for browser testing (heaviest item; see options)
**Found by:** pre-testing audit 2026-10-30 (security pass)

**What to build:** All public-endpoint limiters are per-process in-memory maps (`src/domain/limits.ts:118-142`). On Vercel, every serverless instance keeps its own counters and cold starts reset them, so the effective limit is `limit × instances` and an abuser's burst is spread across fresh containers. The spec requires abuse limits "enforced on the server."

Pick one and record the decision:

- [x] **Preferred:** move the create/return/message limiters to shared Postgres-backed counters (the portable store already spans both backends; a small `rate_limit_hits` table or `INSERT ... ON CONFLICT` window counter suffices). SQLite mode keeps the in-memory limiter.
- [ ] Or: keep in-memory limiting, document the multiplication factor as accepted residual risk for launch, and add a monitoring note so the decision is revisited if abuse appears.

Either way:

- [x] The limiter choice is recorded where `src/domain/limits.ts` is defined, and ticket 11 notes it as a cutover criterion.

## Comments

2026-10-30: Filed from the audit (finding verified by code read; the multiplication behavior is inherent to per-instance state). Related: issue 20 (the key the counters are keyed on).

2026-11-11: IMPLEMENTED (`ready-for-human`) — the **preferred option**: shared database counters.

**Decision**: the create (`"conversation-create"`), return (`"return"`), and message (`"message"`) limiters now run on `createSharedRateLimiter` (`src/api/rateLimit.ts`): on a database backend (`DATABASE_URL` set) every check upserts one `rate_limit_hits` row per (scope, bucket key, window) with `INSERT ... ON CONFLICT DO UPDATE ... RETURNING hits` — one portable statement, identical on SQLite and Postgres — and allows while `hits <= limit`. Windows are wall-clock aligned (`now - now % RATE_WINDOW_MS`, ISO text); the `scope` column keeps each limiter's budget separate where two of them key the same client (create and return both key `publicClientKey`; message keys `conversation.id` as before). Routes `await` the check; the four responses/limits are otherwise unchanged. The credential-free reads (topics, welcome, handoff options, presence) and per-conversation guards (history, clear, contact) stay on the per-process in-memory limiter deliberately. SQLite mode keeps the in-memory limiter (same window/limit contract, per-process) per the ticket.

**Schema**: migration `0016_rate_limit_hits.sql` / `postgres/0006_rate_limit_hits.sql` — `(scope, bucket_key, window_start)` PK, `hits INTEGER`; no FKs, nothing links to conversations. Spent windows are pruned by the existing maintenance pass (`pruneRateLimitWindows` in `src/domain/limits.ts`, called from `/api/maintenance`, reported as `rateLimitWindowsRemoved`) — a budget can never recur two windows later, so older rows are debris; on the Vercel cron (daily) the table stays bounded by keys × windows since the last run.

**Decision record**: `src/domain/limits.ts` carries the module-level decision block (and why the mechanism lives in `src/api` — the widget imports this module's constants, so it must stay server-import-free); ticket 11's file gained the cutover-criterion note.

**Tests** (`tests/shared-rate-limit.test.ts`, TDD red→green; PG_POOL_MAX=2/PG_AUTH_POOL_MAX=2 per PG-suite practice): portable pins on both backends — limit enforced within a window and restored in the next, per-scope/per-key bucket independence, and the prune removes only windows older than the previous one (seeded rows, real maintenance function). Postgres-only block (skips on SQLite by design) proves the ticket's core property: two independent factory instances — as separate serverless instances would construct — share one budget, and a spent bucket recovers when the window rolls. `creation-abuse`'s exact 100/429 boundary now exercises the awaited shared limiter through the real create route (on Postgres mode it therefore pins the shared counter's boundary too).

**Verification**: typecheck clean; PG-mode subset (this file + creation-abuse + visitor-email-return + awaiting-lock + escalation-flow) 21/21; full SQLite suite 447 passed / 3 skipped / 0 failed (restart-persistence included this run). Concurrent-session note: ticket 22's in-flight `assertConfiguredDatabaseUrl` (config.ts/service.ts) was reviewed mid-run — additive, does not alter `appDatabaseUrl()`'s null-when-unset contract that the SQLite fallback relies on.
