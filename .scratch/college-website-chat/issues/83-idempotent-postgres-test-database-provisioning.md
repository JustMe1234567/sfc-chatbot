# 83: Make Postgres test database provisioning idempotent per process

**Status:** ready-for-human  
**Category:** bug (tests only)  
**Priority:** P2  
**Blocked by:** none  
**Related:** [74: Redesign the Visitor contacts table](74-redesign-visitor-contacts-table.md), [68: Fix Postgres test seeds](68-postgres-test-seeds-omit-not-null-last-activity.md), [76: Owner-managed embed allowlist](76-owner-managed-embed-allowlist.md)

## Problem

Ticket 74's `tests/contacts-table.test.ts` exposed a shared test-infrastructure
defect. The file warms the service twice: once in its file-level `beforeAll`
(`useTempDatabase()` + `warmChatbotService()`) and again in a describe-level
`beforeAll` that calls `warmChatbotService()` a second time. Each
`warmChatbotService()` call invokes `provisionTestDatabase()`, which used to
DROP + CREATE the per-file PostgreSQL database unconditionally — so the second
provisioning erased the schema out from under the already-cached service
singleton, and contacts-table failed on Postgres at HEAD.

An existing change in `tests/helpers.ts` attempts to make provisioning
idempotent per process: `provisionTestDatabase()` now records the last
provisioned database name (`provisionedDbName`) and skips the DROP/CREATE when
asked again for the same name. That change currently has no originating ticket
— it rode in with ticket 76's commit (`cbc256b5c`). This ticket authorizes and
verifies that correction on its own merits.

## Scope

- Authorize and verify only the test-infrastructure correction in
  `tests/helpers.ts`.
- Ensure the same per-file PostgreSQL test database is provisioned at most
  once per process.
- Preserve first-call provisioning and test isolation between files/processes
  (each vitest file keeps its own module registry, random database name, and
  fresh migrated database).
- Do not change application behavior, production database handling, schemas,
  or unrelated tests.
- Add or identify focused regression coverage proving repeated warm-up does
  not recreate or erase the database.
- Run the focused test and the PostgreSQL suite.

## Acceptance criteria

- [x] Calling the warm-up/provisioning path repeatedly in one process does not
  drop or recreate an already-provisioned test database.
- [x] The first call still provisions a fresh migrated database.
- [x] Separate test processes/files retain their existing isolation.
- [x] The ticket-74 contacts tests and full PostgreSQL suite pass.
- [x] The correction remains confined to test infrastructure.

## Comments

2026-11-19: Filed from the ticket-74 Postgres run. Provenance: the
`provisionedDbName` guard landed untracked inside ticket 76's commit
(cbc256b5c, "tests/helpers.ts provisionTestDatabase() is idempotent per
process"), which also documents the failure mode — a second DROP+CREATE under
the cached service singleton wiped contacts-table's schema on Postgres. The
guard exists but no test proves it; this ticket gives the correction a home
and adds the missing regression coverage, then commits the ticket separately
from any follow-up correction.

2026-11-19: ASSESSED + COVERED (`ready-for-human`). Assessment: the cbc256b5c
guard already satisfies the correction scope — `tests/helpers.ts` is untouched
by this ticket; the work was the missing coverage. Added
`tests/helpers-provision-idempotent.test.ts` (2 tests):

- **Survival**: warm → write a conversation through the portable Store → warm
  again → the row survives. Red-proven by temporarily reverting the
  `provisionedDbName` guard: the test fails with `PostgresError: relation
  "conversations" does not exist`, the exact ticket-74 failure mode. Field
  asserts (`id`/`state`/`createdAt`) instead of whole-object equality because
  the Postgres store stamps `visitor_last_seen_at` with the creation time —
  dialect default, not this ticket's subject. Runs (trivially green) on
  SQLite too.
- **Name stability** (PG-only, skips on SQLite): repeated `useTempDatabase()`
  keeps `CHATBOT_TEST_PG_DBNAME`/`DATABASE_URL` stable. Red-proven by
  breaking the `postgresDbName` memo: the second call minted a fresh
  `sfc_test_*` name — which would provision a second database while the
  cached singleton keeps serving the first, the code review's gap in "at most
  once per process".

Verification: focused pair with contacts-table 13/13 on Postgres; full
PostgreSQL suite 573 passed / 3 skipped (restart-persistence by design); full
SQLite suite 570 passed / 6 skipped; `tsc --noEmit` clean. Review: standards
axis clean (the inline Conversation literal is house practice for
single-conversation files); spec axis found the name-stability gap, closed by
the second test. Cross-file/process isolation is suite-verified per this
ticket's own "run the PostgreSQL suite" scope (each file mints its own random
database in its own module registry) rather than by a dedicated cross-process
test.
