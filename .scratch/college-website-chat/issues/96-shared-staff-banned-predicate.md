# 96: One shared staff banned-value predicate at all three check sites

Status: done

Filed from ticket 94's human decision session (2026-11-21, item 4,
fix approved).

## What to build

The canonical banned check — `banned === true || banned === 1 ||
banned === "1"` — lives inline at `src/api/staff.ts:56`. Two other
sites re-implemented it and each dropped the string-`"1"` shape:

- `src/app/api/staff/members/[id]/reset-password/route.ts:44`
  (`target.banned === true || target.banned === 1`)
- `scripts/recover-staff-credentials.ts:48`
  (`member.banned === true || member.banned === 1`)

Extract one small exported predicate (name it after the repo's
existing style, e.g. `isStaffBanned(value: unknown): boolean`), place
it next to the canonical check in `src/api/staff.ts` (or the domain
module staff helpers already share if one exists), and use it at all
three sites. The semantic to pin is the canonical triple variant —
including the string-`"1"` shape — exactly as `src/api/staff.ts:56`
behaves today. No other behavior changes: refusal responses, status
codes, and the surrounding `emailVerified`/role checks stay as they
are.

## Acceptance criteria

- A unit test pins the predicate's shape table: `true`, `1`, and
  `"1"` are banned; `false`, `0`, `"0"`, `null`, and `undefined` are
  not.
- The reset-password route and the recover-staff-credentials script
  route their decision through the shared predicate (their inline
  `banned ===` chains are gone).
- Existing behavior is unchanged for the boolean/number shapes every
  site already covered; the string-`"1"` shape now refuses at the two
  previously-drifted sites (a banned flag of `"1"` yields the same
  refusal each site already returns for `true`).
- `src/api/staff.ts:56`'s own decision path also uses the predicate
  (the canonical site delegates instead of duplicating).

## Comments

2026-11-21: Filed from ticket 94's decision session (item 4, fix
approved). Ticket 94 fixed nothing itself, per its acceptance
criteria.

2026-11-21: **COMPLETE. All four acceptance criteria pass.** Built on
branch `codex/ticket-96-shared-banned-predicate`.

- `isStaffBanned(value: unknown): boolean` exported from
  `src/api/staff.ts`, directly above `requireStaff` whose banned check
  it replaces. Doc comment states the stored shapes (BOOLEAN on
  Postgres, INTEGER 0/1 on SQLite, string `"1"` from text round-trips)
  and that it is the one predicate every banned decision routes
  through. Semantic is exactly the canonical triple variant — verified
  red-to-green against the new test.
- All three sites route through it; the inline `banned ===` chains are
  gone: the canonical `requireStaff` check, the reset-password route
  (`src/app/api/staff/members/[id]/reset-password/route.ts`, import
  added to its existing `@/api/staff` import), and the recovery script
  (`scripts/recover-staff-credentials.ts`, imports from
  `../src/api/staff`). Refusal responses, status codes, and the
  surrounding `emailVerified`/role checks are untouched. The two
  previously-drifted sites now also refuse the string-`"1"` shape with
  the same response each already returns for `true`.
- Shape-table unit test `tests/staff-banned-predicate.test.ts`:
  refuses `true`/`1`/`"1"`, admits `false`/`0`/`"0"`/`null`/
  `undefined`, 8 cases, watched failing before the predicate existed.
- Scope note: no domain staff-helpers module existed to host the
  predicate (`src/domain/` has none), so the ticket's primary
  placement — next to the canonical check in `src/api/staff.ts` —
  applies. The private `truthy`/`isBanned`/`enabled` helpers in
  `src/api/staffMembers.ts`, `src/auth/provision.ts`, and
  `src/auth/supabase-provider.ts` were left alone: the ticket names
  exactly three sites and forbids other behavior changes, and ticket
  94's disposition accepted those sites as-is.
- Script import chain verified: `scripts/recover-staff-credentials.ts`
  now transitively imports `next/server` via `src/api/staff`; a tsx
  load of the script module resolves and executes cleanly to its
  argument check (no module errors), so the recovery path keeps
  working.
- Verification: focused test 8/8; full suite 585 passed / 7 skipped,
  67 files passed / 2 skipped (the skips are the pre-existing
  PG-cluster files absent a local cluster); `tsc --noEmit` clean;
  hygiene check passed (779 files). Production build and production
  data untouched.

2026-11-21: **Review amendment — two actionable findings fixed.** The
two-axis review (Standards + Spec, run in parallel sub-agents over the
pre-commit delta vs origin/main 60ab5de20; no `Reviewed through:`
marker existed in this record, so the full delta was in scope) found
no hard violations and met all four acceptance criteria with zero
scope creep. Fixed findings, re-verified with the focused test 8/8 +
`tsc --noEmit` + a fresh full-suite run (67 files passed / 2 skipped)
on the amended content before committing:

- **FIXED — doc-comment overclaim:** `isStaffBanned`'s comment said it
  is "the one predicate every banned decision routes through" while
  three same-semantic private helpers (`truthy` in
  `src/api/staffMembers.ts`, `isBanned` in `src/auth/provision.ts`,
  `enabled` in `src/auth/supabase-provider.ts`) still decide
  independently. Both reviewers flagged it; the comment now names the
  three wired sites (dashboard, owner password resets, credential
  recovery) instead of claiming universality.
- **FIXED — test readability:** the `test.each` shape table dropped
  its `map((shape) => [shape] as const)` tuple indirection for a plain
  `test.each([true, 1, "1"] as const)`-style array; equivalent
  semantics, 8 cases unchanged.

Recorded, not actioned (sanctioned): the Duplicated Code smell of four
same-semantic predicates now in the codebase is deliberate scope —
AGENTS.md's build-exactly-what-the-ticket-asks rule overrides the
smell baseline, ticket 94's dispositions accepted the three private
helpers as-is, and any consolidation belongs in a follow-up ticket
(none filed; the owner can request one). Also noted, no action: the
recovery script's import graph now transitively includes `next/server`
via `src/api/staff` (heavier but verified loadable under tsx and
consistent with the script's existing relative imports), and a
domain type for the flag was judged Speculative Generality.

Reviewed through: af08e842a
