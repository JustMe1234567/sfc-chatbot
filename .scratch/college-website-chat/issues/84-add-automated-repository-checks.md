# 84: Add automated repository checks

**Status:** ready-for-human  
**Category:** chore (infrastructure)  
**Priority:** P3  
**Blocked by:** none  
**Related:** [11: Supabase Postgres backend with Vercel deployment path](11-*) — the deployment this guard protects

## Context

Before this work, nothing automated gated a pull request: hygiene, typechecking,
tests, and the production build all ran only when someone remembered to run
them locally. The same gap existed on the deployment side — Vercel CLI uploads
pack whatever is not explicitly excluded, so secrets, local databases, scratch
worktrees, and machine-local skill installations could ride a deploy (a
`.vercelignore` *replaces* `.gitignore` for CLI uploads, so every exclusion has
to be repeated there or it gets packed). This ticket retrospectively records
user-authorized reconciliation work that was implemented in commit
`0f0929a53` before the ticket existed.

## Desired behavior

1. Pull requests run the repository's full check gate automatically: a GitHub
   Actions workflow (Node 22, `npm ci`) executes one command, `npm run check`,
   which chains repository hygiene → typechecking → tests → production build.
2. Files that must never be versioned or uploaded are blocked on both paths:
   - **Git side**: a hygiene script scans tracked files and fails the check
     when anything lands in the blocked categories (databases, secrets, logs,
     local worktrees, temporary skill installations).
   - **Vercel side**: a `.vercelignore` mirrors those exclusions for uploads,
     with carve-outs so the versioned issue tracker, approved specs, and
     reference evidence under `.scratch/college-website-chat/` and
     `.scratch/supabase-auth/` stay deployable.
3. Existing development and deployment behavior is otherwise unchanged: the
   `check` and `hygiene` npm scripts are additive, and no application source
   is touched.

## Acceptance criteria

- [x] A `pull_request`-triggered workflow (`.github/workflows/check.yml`,
  read-only `contents` permission, Node 22, `npm ci`) runs `npm run check`.
- [x] `npm run check` = `hygiene && typecheck && test && build` — hygiene,
  typechecking, tests, and the production build all gate the PR.
- [x] The hygiene script (`scripts/check-repository-hygiene.mjs`) scans
  `git ls-files` against five blocked categories — database
  (`*.db`/`*.sqlite*` + `-shm`/`-wal`), secret (`.env*` except the example,
  credential/service-account JSON, private keys, `*.key|pem|p12|pfx`), log
  (`*.log`), worktree (`.worktrees|worktrees/`), and temporary skill
  installation (`.agents/skills/design-taste-frontend|ui-ux-pro-max/`,
  `.codex/skills/`) — and exits non-zero listing every violation.
- [x] `.vercelignore` excludes secrets, databases, dependency/build/coverage
  output, scratch debris, and installed skill copies while keeping the
  versioned tracker/spec/reference directories (negative patterns in place).
- [x] Development and deployment behavior outside these checks is unchanged —
  the only non-additive touch is `next-env.d.ts`'s generated route-type
  imports moving from the dev to the build path (a Next.js regeneration, not
  a behavior change).

## Out of scope

Making the checks required branch protection on `main`, running the workflow
on direct pushes, adding lint/format tooling, changing what `next dev`/`next
build` do, altering application code or the Vercel project's regions/crons,
and deciding what the excluded files' contents are.

## Implementation record

Commit `0f0929a53` (2026-11-19, "chore(repo): add automated repository
checks"): `.github/workflows/check.yml` (new, 26 lines), `.vercelignore`
(new, 40 lines), `scripts/check-repository-hygiene.mjs` (new, 53 lines),
`package.json` (+`check` and `hygiene` scripts), `next-env.d.ts` (generated
route-type import paths regenerated).

## Comments

2026-11-19: Filed retrospectively — user-authorized reconciliation work
already implemented before the ticket existed; this file records it for final
review. Verification: the workflow file is present at HEAD and `0f0929a53` is
its only originating commit; `npm run check` (all four gates including the
production build) was run green on a tree containing the commit during this
filing session; the hygiene category list and `.vercelignore` carve-outs were
confirmed by reading the committed diff.
