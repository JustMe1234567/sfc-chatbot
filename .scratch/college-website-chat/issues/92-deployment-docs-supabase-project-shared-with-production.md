# 92: Say plainly in the deployment docs that the Supabase project is shared with production

Status: ready-for-agent

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
