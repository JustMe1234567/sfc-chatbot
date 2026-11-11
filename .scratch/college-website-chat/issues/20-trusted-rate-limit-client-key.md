# 20: Derive the public rate-limit key from a trusted proxy source

**Status:** ready-for-human
**Priority:** P2 — security blocker for browser testing
**Found by:** pre-testing audit 2026-10-30 (security + spec passes; verified directly)

**What to build:** `publicClientKey` takes the **first** `X-Forwarded-For` entry as the rate-limit key (`src/api/visitor.ts:39`). On any proxy that appends to the header (the standard behavior), a client can rotate spoofed leftmost values and bypass every public limiter — conversation creation, message floods, return-link redemption attempts, analytics presence. Ticket 01 explicitly parked "production x-forwarded-for handling" on ticket 11; ticket 11 never picked it up, so the parked item was silently dropped.

The deployment path is Vercel, where the platform sets trustworthy headers. Make the key source explicit for that topology:

- [x] In production, derive the client key from the platform-trusted source (e.g. `x-real-ip` / the rightmost hop added by the platform, or Vercel's `x-vercel-forwarded-for`), never the client-controllable leftmost XFF value.
- [x] Local development keeps today's behavior (no trusted proxy → shared bucket).
- [x] A test pins the choice: a request with a spoofed leftmost XFF and a trusted platform header shares/uses the trusted value.
- [x] The assumption about the platform's header behavior is documented where `publicClientKey` lives.
- [x] Ticket 11's file gains a line noting the parked item landed here.

## Comments

2026-10-30: Filed from the audit. Verified: `src/api/visitor.ts:33-40`; ticket 01 acceptance note ("production x-forwarded-for handling … parked on ticket 11"); ticket 11 file contains no mention of it. Related: issue 24 (per-process limiter state).

2026-11-11: IMPLEMENTED (`ready-for-human`).

`publicClientKey` (`src/api/visitor.ts`) branches on the repo's production convention (`NODE_ENV === "production"`, as in `config.ts`/`auth/server.ts`/`mail/transport.ts`). In production the key is the first entry of `x-vercel-forwarded-for` (Vercel's platform-computed chain — the documented assumption: the Vercel edge *overwrites* `x-forwarded-for` and does not forward external IPs precisely to prevent spoofing, and `x-vercel-forwarded-for` carries that same value even when another proxy sits on top of Vercel; `x-real-ip` matches it there and is the conventional trusted header on other reverse proxies), falling back to `x-real-ip`, and otherwise to the shared `"local"` bucket — never to any client-supplied value. Local development (and the test suite, `NODE_ENV=test`) keeps today's behavior: leftmost `x-forwarded-for` entry, shared bucket when absent, so per-IP test rotation (`analytics-presence`, `auth-helpers`) is unchanged.

**Test** (`tests/visitor-client-key.test.ts`, 5 cases, TDD red→green): production prefers the trusted header over a spoofed leftmost XFF; falls back to `x-real-ip`; a spoofed-XFF-only request cannot mint an identity (equals the no-headers shared bucket); the limiter-level pin — two requests with *different* spoofed XFFs but the same `x-vercel-forwarded-for` exhaust one bucket (limit 1, fixed `now`); and local development keeps leftmost-XFF/shared-bucket behavior. Typecheck clean; full suite 434 passed / 4 skipped, the single failure being the pre-existing restart-persistence env-fail (this machine's running `next dev` holds the Next dev lock — unrelated to this ticket). No route files changed: all six public limiters call `publicClientKey`, so the fix applies everywhere at once. Ticket 11's file carries the parked-item landing note.
