# 91: Document the local PostgreSQL-suite command and its CREATEDB trap

Status: ready-for-agent

## What to build

The README's Postgres-suite recipe is a generic placeholder
(`postgres://user:pass@host:5432/postgres`) and nothing in the repo
records how to run the suite against this machine's local cluster, where
the obvious attempt fails. In the README's testing section (where the
generic recipe lives), document the exact working command and the trap
behind it:

- The command:
  `CHATBOT_TEST_POSTGRES_URL="postgresql://postgres@127.0.0.1:5433/postgres" npm test`
- The trap: the suite provisions one database per test file (ticket 83),
  and on the local 5433 cluster the only role carrying CREATEDB is the
  `postgres` superuser. The `postgres.bml…` pooler-style role (created by
  the cert79 session) answers `SELECT 1` fine but fails 38 test files
  with `permission denied to create database`.

Documentation only — do not change any script or test.

## Acceptance criteria

- The README's testing section names the exact local command that works.
- The CREATEDB/superuser trap is stated in one or two sentences next to
  it.
- `npm run check` stays green (docs-only change).

## Comments

2026-11-20: Filed from the session retro. Evidence: the ticket-90
session's first PG-suite run used the wrong role and lost a full run
(38 failed files, ~60 s) to the trap; the working command was recovered
from agent memory, not from the repo.
