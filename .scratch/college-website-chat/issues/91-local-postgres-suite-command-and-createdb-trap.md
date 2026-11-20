# 91: Document the local PostgreSQL-suite command and its CREATEDB trap

Status: done

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

2026-11-20: **Implemented.** The README's Postgres-suite section (under
"Production database (Postgres)", where the generic hosted recipe lives)
now names the exact working local command —
`CHATBOT_TEST_POSTGRES_URL="postgresql://postgres@127.0.0.1:5433/postgres" npm test`,
introduced as the way to run the suite against this machine's local
cluster (port 5433) as the `postgres` superuser — followed by the trap
in two sentences, as written in the ticket: the suite provisions one
database per test file (ticket 83) and on the local 5433 cluster the
only role carrying CREATEDB is that superuser, while the cert79-created
`postgres.bml…` pooler-style role answers `SELECT 1` fine but fails 38
test files with `permission denied to create database`. Documentation
only; no script or test changed. All three acceptance criteria met.

Verification: `npm run check` exit 0 — hygiene (777 tracked files
scanned), typecheck, SQLite suite 577 passed / 7 skipped (68 files, 2
skipped), production build. Before the edit, the branch was reconciled
with origin/main by fast-forward (9f7a1adb8 → 40faed0f0, PR #3's merge;
zero content delta), so this work sits on latest main with no ticket 92
or 93 changes mixed in. A live re-verification of the 5433 cluster was
not possible this session (the machine-local server is not currently
running — `ECONNREFUSED`); the command and role behavior are the
ticket-90-session evidence this ticket was filed from, unchanged.
