# 92: Say plainly in the deployment docs that the Supabase project is shared with production

Status: done

## What to build

`docs/deployment.md` opens by calling the named Supabase project
(`bmlwasuvujkfchnbklls`) a "dedicated test project", but it is also the
database the production Vercel deployment serves: the production owner
identity, live staff rows, and real login_events all live there — the
Vercel production `DATABASE_URL` and the local `.env.local` point at the
same project ref. Add one plain statement near the top of
`docs/deployment.md`: this single project is shared with production, so
every mutation against it — owner bootstrap, certification identities,
SQL deletes — is a production mutation and must be handled with
production care.

May optionally note the operational consequence for the cert recipes
(cert70/81/82 bootstrap and fully clean up disposable identities on this
shared project). Do not rename the project, do not change any code or
script; documentation only.

## Acceptance criteria

- `docs/deployment.md` states the shared-with-production fact plainly
  near the project introduction.
- No behavioral changes anywhere.

## Comments

2026-11-20: Filed from the session retro. The "test project" framing
invited cert sessions to treat the shared store as disposable; nothing
went wrong this week only because the cleanup discipline held. The
production deployment and post-merge verification confirmed the sharing
again: the same project ref serves both the Vercel app and local runs.

2026-11-20: **COMPLETE.** Status set to `done` — a terminal marker
outside the five triage roles, per the owner's standing instruction
(ticket 90 convention). Implemented from the pre-merge uncommitted edit;
resumed after PR #2 (97295a6d0) merged. That PR touched only tracker
files and did not touch `docs/deployment.md`, so the edit applies
cleanly on the fully-merged branch tip 9240979bc.

- `docs/deployment.md` gains one paragraph directly after the intro
  paragraph (the sentence introducing "one dedicated Supabase test
  project"): it names the project (`bmlwasuvujkfchnbklls`), states
  plainly that the production Vercel deployment serves the same database
  — production owner identity, live staff rows, real login_events — and
  that every mutation against it (owner bootstrap, certification
  identities, SQL deletes) is a production mutation requiring production
  care. Includes the optional cert-recipe note: cert70/81/82 bootstrap
  and fully clean up disposable identities on this shared project. No
  project rename, no code or script changes.
- Verification: `npm run hygiene` passed (777 tracked files); `npm run
  typecheck` passed; full suite 577 passed / 7 skipped (pre-existing
  environment-gated skips, e.g. the superuser-URL-gated suite), 0
  failed. Build skipped: a markdown diff outside the app graph cannot
  affect the Next build. The `docs/deployment.md` diff is a 2-line
  markdown-only insertion; the tree's only other modification is this
  record.
- Acceptance criteria met: the shared-with-production fact is stated
  plainly near the project introduction; no behavioral changes anywhere.
- Committed on `codex/supabase-auth` with explicit pathspecs (this file
  + `docs/deployment.md`) in the commit carrying this record; not
  pushed — push/merge awaits the owner.
