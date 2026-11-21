# 98: Guarded operator command to rename the staging owner username (owner → sfc-admin) plus secure password reset

Status: done

Filed 2026-11-21. The staging owner account signs in with the generic
username `owner`; it should be `sfc-admin`. A username rename cannot be a
dashboard feature — if the only owner cannot sign in, only an operator
command can fix it — and the follow-up password reset must never put a
password into PowerShell history or shell logs.

## What to build

**Operation 1 — rename (new guarded operator command, not a dashboard
feature).** `npm run rename:staff -- --from <current-username> --to
<new-username> --identity-verified`:

- Requires the current username, the new username, and the explicit
  `--identity-verified` flag; refuses to run without all three.
- Validates the new username with the application's existing username
  rule (`/^[a-z0-9._-]{3,32}$/` after trim + lowercase, the rule the
  members POST route and recover:staff already enforce).
- Finds the source account case-insensitively (`lower("username") =
  lower(?)`, the lookup shape every existing staff query uses).
- Verifies the source account is active (not banned), has role
  `owner`, and has a linked Supabase user ID; refuses otherwise with a
  distinct reason.
- Refuses when an account already exists with the destination username,
  case-insensitively — including disabled accounts (the unique index on
  `lower("username")` spans every row).
- Refuses unless exactly one active owner exists (the source must be
  *the* owner, not one of several).
- Renames inside one database transaction (the keyed
  `db.transaction` guard, so the count-then-write decisions cannot go
  stale mid-rename), writing only the application username and the row's
  `updatedAt` timestamp.
- Preserves the staff ID, Supabase user ID, name, role, email, created
  timestamp, sessions (Auth sessions key on the Supabase user ID), and
  all related data (audit rows, conversation claims, login log entries
  reference the staff ID).
- Never creates, modifies, or deletes a Supabase Auth user: the rename
  touches only the application database and must not construct an auth
  provider or call any admin API. Sign-in keeps working because the
  Auth user's email is `<staffId>@staff.invalid`, derived from the
  preserved staff ID.
- On refusal, makes no write at all: every guard failure leaves the
  store byte-identical (on Postgres the keyed transaction rolls back).

**Operation 2 — password reset (distinct second operation).** The
existing `recover:staff` command keeps its behavior and compatibility,
including session revocation. Add secure password input to it: when
`--password` is omitted, read the password interactively — a hidden
prompt on a TTY, or the first line of piped stdin — so the password
never appears in PowerShell history, npm output, commits, or reports.
`--password` keeps working for scripted use. The password is never
echoed, logged, or included in error messages.

Out of scope: executing the rename against the shared staging database
(that is the owner's post-merge step), any dashboard/UI change, and any
change to how usernames are validated elsewhere.

## Acceptance criteria

- Focused tests cover: successful `owner` → `sfc-admin` rename
  (identity, Supabase link, name, role, created timestamp, and email
  preserved; username and `updatedAt` changed); missing source;
  duplicate destination; non-owner source; disabled source; unlinked
  source; multiple active owners; invalid destination username;
  rollback/no-write on refusal; and secure password input that never
  writes the password to the output stream (both the hidden-TTY path
  and the piped-stdin path).
- `npm run check` passes.
- The shared staging database is not touched during implementation or
  testing; no `.env.local`, credentials, passwords, or generated
  evidence containing secrets is committed.
- `docs/deployment.md` documents the two-step procedure (rename, then
  password reset with the secure prompt) next to the existing
  recover:staff documentation.
- `/code-review` from the starting commit passes with only in-scope
  findings addressed; the PR is created and checks monitored, but not
  merged.

## Comments

2026-11-21: Filed with the implementation in the same session per the
standing ask-matt workflow; the ticket is the anchor for the /code-review
spec axis.

2026-11-21: **Done (bbff20fd7, review fixes 9dfd67bcc).** Branch
`codex/ticket-98-owner-username-rename` off origin/main = a607804d7;
pushed with the PR, not merged. Evidence:

- `npm run check` passed end-to-end (hygiene 781 files, typecheck,
  69 test files / 598 tests, next build). The two focused suites are
  `tests/staff-username-rename.test.ts` (9 tests: success rename with
  preservation assertions, missing source, duplicate destination
  case-insensitive + disabled, non-owner, disabled source, unlinked
  source, multiple owners, invalid destination, refused-rename leaves
  the roster byte-identical) and `tests/secure-password-input.test.ts`
  (5 tests: piped path never writes the secret, TTY path echoes only
  prompt + newline and toggles raw mode, Ctrl-C cancels, empty pipe,
  multi-byte keystroke split across chunks).
- The staging database was never touched during implementation or
  testing; all suites ran against a temp SQLite store.
- The rename writes only `username` + `updatedAt` inside the keyed
  transaction; `isStaffBanned` (ticket 96's shared predicate) is reused;
  no auth provider is constructed anywhere in the rename path.
- `/code-review` from the exact starting commit a607804d7: Standards
  axis found no hard violations; Spec axis found no missing/partial
  requirements and no scope creep. In-scope findings fixed in
  9dfd67bcc: the "shared verbatim" comment overstated sharing (worded
  as a match instead), recover:staff's twice-repeated usage string
  hoisted, and the spec axis's real find — TTY secret input decoded per
  chunk, mangling a multi-byte character split across stdin chunks —
  fixed with a StringDecoder plus a regression test. Out-of-scope
  smells parked below.

Parked judgement calls (ticket-94-style dispositions, none blocking):

- `readFlag` now exists in three scripts (bootstrap-owner, recover:staff,
  rename:staff) — per-script copies are the existing convention;
  extraction is follow-up material.
- The `openPostgres → migratePostgres → … → sql.end` operator wiring is
  duplicated between recover and rename; likewise follow-up material.
- `normalizeStaffUsername`/`isValidStaffUsername` are one-line helpers,
  kept for the domain naming.
- `migratePostgres` runs before the guards in both operator commands,
  so a pending migration would apply even on a refused rename —
  idempotent and identical to recover:staff's existing behavior.
- `DATABASE_URL` is a fourth required input beyond the ticket's three —
  matches every existing operator script and appears in the usage text.

Reviewed through: bbff20fd7
