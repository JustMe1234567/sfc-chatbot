# 89: Settings page's 8 concurrent reads starve the Postgres pool

Status: ready-for-agent

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
