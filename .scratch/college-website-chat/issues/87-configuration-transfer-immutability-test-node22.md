# 87: Make the configuration-transfer source-immutability test Node 22 compatible

**Status:** ready-for-human
**Category:** bug (tests only)
**Priority:** P1
**Blocked by:** none
**Related:** [84: Add automated repository checks](84-add-automated-repository-checks.md), [83: Make Postgres test database provisioning idempotent per process](83-idempotent-postgres-test-database-provisioning.md), [Supabase Auth spec](../supabase-auth/spec.md)

## Problem

The GitHub `Check` / `check (pull_request)` workflow failed on
`tests/configuration-transfer.test.ts`. CI runs Node 22 (`.github/workflows`
pins `node-version: 22`; `package.json` declares `engines.node >=22`), but the
test proved source immutability with
`DatabaseSync.serialize()` at lines 63 and 75 — a method the local Node 24.19
runtime has and CI's Node 22 does not. The incompatibility was hidden locally
because development runs on Node 24.19, and no check reproduced the CI Node
version before pushing.

The test's purpose stands: configuration export/import must not mutate the
source database. The proof mechanism is what has to change. Raw SQLite
serialization is also the wrong shape on principle — `serialize()` returns
file bytes, and WAL (plus page layout) makes byte comparisons unsuitable; a
deterministic logical snapshot of the configuration rows is the stable
invariant.

## Scope

- Replace both `source.raw.serialize()` calls in
  `tests/configuration-transfer.test.ts` with a deterministic logical snapshot
  taken through the existing `AppDatabase` interface: ordered `answer_rules`
  (all columns) and ordered `settings`, snapshotted before export/import and
  re-queried afterward, compared with `toEqual`.
- Deterministic ordering: `ORDER BY id` for rules (primary key), `ORDER BY key`
  for settings — both unique, stable, and portable to Postgres.
- Preserve the test's existing purpose and its remaining assertions
  (target rule order/status/attribution, re-import refusal) untouched.
- Do not read SQLite database files directly; do not change production code,
  application behavior, the CI Node version, or the package's Node engine
  requirement.

## Acceptance criteria

- [x] No `.serialize()` call remains in the repository.
- [x] The snapshot comparison still proves the source is not mutated by
  export/import (fails if the source configuration tables change).
- [x] The focused configuration-transfer test passes.
- [x] `npm run check` passes (hygiene, typecheck, full suite, build).
- [x] The change is confined to `tests/configuration-transfer.test.ts`.

## Comments

2026-11-20: Filed from the red PR check on `codex/supabase-auth`. The check
exposed a Node 22 incompatibility hidden by the local Node 24.19 runtime —
worth remembering when a test reaches below the `AppDatabase` abstraction to
raw `node:sqlite` methods: CI's Node may not have them. This ticket is the
review amendment for the configuration-transfer test introduced with the
Supabase auth work (the originating spec's transfer section), filed as its own
test-compatibility ticket because no per-ticket file exists for that work.

2026-11-20: IMPLEMENTED. `tests/configuration-transfer.test.ts` only: added a
`sourceSnapshot(db)` helper reading ordered `answer_rules` + `settings`
through `AppDatabase`, and replaced both `serialize()` calls with
snapshot-before / snapshot-after comparison. Focused test 2/2 green;
verification results appended below.

2026-11-20: VERIFIED. Focused configuration-transfer test 2/2 passed.
`tsc --noEmit` clean. `npm run check` exit 0 — hygiene passed (759 tracked
files scanned), 570 tests passed / 6 skipped (64 files passed / 1 skipped),
Next build succeeded. Repo-wide search for `.serialize(` across src/, tests/,
scripts/ finds only the helper's explanatory comment naming the method that
does not exist on Node 22 — no code dependency remains. Pushed to
`codex/supabase-auth`; CI check result to be recorded when green.
