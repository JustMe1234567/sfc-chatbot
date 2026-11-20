# 96: One shared staff banned-value predicate at all three check sites

Status: ready-for-agent

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
