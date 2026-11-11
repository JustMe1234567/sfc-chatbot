# 31: Document every environment variable with .env.example

**Status:** ready-for-human
**Priority:** P2 — docs, queued (non-gating)
**Found by:** pre-testing audit 2026-10-30 (docs pass, line-cited)

**What to build:** `.gitignore` explicitly un-ignores `.env.example`, but no such file exists, and several optional variables the app reads are undocumented anywhere:

- `POSTGRES_URL` — fallback alias for `DATABASE_URL` (`src/config.ts:34`)
- `PG_PREPARE`, `PG_POOL_MAX` (`src/db/postgres.ts:20-21`)
- `PG_AUTH_POOL_MAX` (`src/db/service.ts:69`)
- `CHATBOT_MAIL_TRANSPORT` (`src/mail/transport.ts:59`)
- `NEXT_PUBLIC_CHATBOT_BASE_URL` (`src/lib/auth-client.ts:9`)
- Documented-elsewhere but worth listing: `CHATBOT_DB`, `BETTER_AUTH_SECRET`, `CRON_SECRET`, `CHATBOT_TEST_POSTGRES_URL`, plus the required production trio (`DATABASE_URL`, `BETTER_AUTH_SECRET`, mail sender keys).

- [x] `.env.example` exists with every variable above, realistic example values, and one-line comments (secrets left blank).
- [x] `README.md`/`docs/deployment.md` point at it; no documented variable is one the app ignores.
- [x] After issue 19 lands, the example includes the Postgres bootstrap flow.

## Comments

2026-10-30: Filed from the audit.

2026-11-12: Implemented in commit d8563e6 (docs-only). .env.example documents all 16 user-configurable variables the app reads: the ticket's enumerated list plus two post-audit additions required to keep the "every variable" claim true — CHATBOT_REQUIRE_DATABASE_URL (ticket 22) and RATE_WINDOW_MS (ticket 24's shared limiter). Deliberate exclusions: NODE_ENV/NEXT_RUNTIME (framework-managed), CHATBOT_TEST_PG_DBNAME (written by the test harness itself), and cert-script conveniences (SHOT_EMAIL/SHOT_PASSWORD/SKIP_WIDGET — documented in the script headers, not app config). Every comment was spot-checked against its cited code (postgres.ts prepare/pool semantics, transport.ts mail modes + the production-refusal error, helpers.ts PG parity mode, bootstrap-owner's migration-first store targeting); secrets blank, non-secret defaults filled (CHATBOT_DB=chatbot.db, PG_POOL_MAX=8, PG_AUTH_POOL_MAX=2, RATE_WINDOW_MS=60000, a fictional MAIL_FROM). README's Run-locally section and docs/deployment.md's env table both point at it (the latter via the correct ../.env.example relative path). Note for review: comments on BETTER_AUTH_SECRET/DATABASE_URL run 2-4 lines rather than strict one-liners — clearer than the spec's minimum. Both review axes passed; the full-suite/typecheck failures in the shared tree at commit time are the concurrent ticket-69 session's half-landed Store refactor, not this docs-only diff.