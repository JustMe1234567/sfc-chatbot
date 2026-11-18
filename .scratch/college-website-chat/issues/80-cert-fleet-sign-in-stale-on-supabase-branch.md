# 80: Cert/shot fleet's owner sign-in is stale on the Supabase auth branch

**Category:** chore
**Status:** ready-for-human

## Summary

The Supabase auth branch (75fcedd31, ticket 11's final revision) replaced email
sign-in with username sign-in (`authClient.signIn.username`, `#username` field)
and made hosted Supabase Auth the only password verifier. The cert/shot fleet
still fills `#email` with `owner@example.edu` — a credential the current stack
neither has nor accepts — and several scripts wipe "enrollment" through
`node:sqlite` against Better-Auth-era tables. Every owner-UI script in the
fleet therefore fails at its sign-in step on the current tree, regardless of
the ticket-76 embed allowlist (which ticket 78 already handled separately).

Discovered while implementing ticket 78: cert70 had to be adapted to the
username flow anyway (its acceptance criterion required completing
end-to-end); the rest of the fleet was left untouched as out of scope.

**Affected files (18):**

- `scripts/lib/shot-driver.mjs` — `enrollAndSignIn`/`signInWithTotp` fill
  `#email`; the enroll flow also predates the "Begin enrollment" button and
  the same-page TOTP stage. Fixing the shared driver fixes every shot script
  that imports it.
- Standalone certs with their own sign-in blocks: `cert29-a11y-polish.mjs`,
  `cert66-widget-gate.mjs`, `cert67-handoff-options.mjs`,
  `cert74-contacts.mjs`, `cert75-contacts.mjs`, `cert28-dashboard-a11y.mjs`
  (via its own flow).
- `scripts/cert70-branding.mjs` is already adapted (ticket 78); listed for
  completeness only.

`freshTotpSlate`/inline enrollment wipes in cert66/67/29 and the shot driver
query `"user"`/`twoFactor` tables through `node:sqlite`; on this branch staff
lives in `staff_members` and TOTP factors live in hosted Supabase Auth, so the
wipes need a rethink (no-op, reframe, or removal) as part of the same pass.

## Desired behavior

- The shared driver's sign-in flows drive the current login page: `#username`
  + `#password` → either `/dashboard/enroll` (fresh account: "Begin
  enrollment" → read secret from `code` → confirm → sign-out → full sign-in
  with the same-page TOTP stage) or the TOTP challenge stage.
- Standalone certs adopt the same flow (cert70's adapted block is the working
  reference).
- Enrollment wipes are honest about the new substrate.

## Out of scope (needs the maintainer's decision before any RUN)

- Where owner-UI runs get their substrate. On this branch a fresh scratch
  database cannot authenticate staff at all: password checks delegate to
  hosted Supabase Auth and session validation reads Supabase's `auth` schema
  inside the DATABASE_URL database itself. The only currently viable run
  substrate is the hosted Supabase test project (per `docs/deployment.md`),
  which holds shared state — creating disposable cert owners there needs an
  explicit yes. Ticket 78's cert70 end-to-end run is parked on exactly this
  decision.

## Acceptance criteria

- [ ] `shot-driver.mjs` signs a freshly bootstrapped owner in through the
      current UI (username flow), and every script importing it works against
      a server whose auth substrate is provisioned.
      *(Implemented 2026-11-19 as an exact port of cert70's proven block —
      `#username`/`#password` → `/dashboard/enroll` → "Begin enrollment" →
      secret from `code` → same-page TOTP stage → `/dashboard/inbox` — but
      the sign-in RUN itself stays parked on the out-of-scope substrate
      decision below, so "works against a provisioned server" is unproven
      end-to-end. `enrollAndSignIn` fails fast with instructions when it
      meets an already-enrolled owner instead of the old silent wipe.)*
- [x] The standalone certs' sign-in blocks match the current login/enroll
      pages. *(cert28/29/66/67/74/75 + the eight shot scripts with their own
      blocks ported to the username flow; verified by inspection against
      `login/page.tsx`, `enroll/page.tsx`, and cert70's reference, not by a
      RUN.)*
- [x] Enrollment wipes no longer reference dead Better-Auth-era tables, or
      are explicitly reframed with a comment explaining what they wipe now.
      *(Removal everywhere: `freshTotpSlate` deleted from the driver; the
      inline `node:sqlite` wipes in cert29/66/67 and the shot scripts
      dropped, each site carrying a comment that factors live in hosted
      Supabase Auth and the owner must be freshly bootstrapped. The
      SQLite-era *seeding* blocks stay untouched — parked on the same
      substrate decision, and answers-shots/answers-lifecycle seed
      attribution now passes a commented placeholder.)*
- [x] No application source changes; scripts only.

## Implementation notes (2026-11-19)

- `SHOT_EMAIL` is renamed `SHOT_USERNAME` (default `owner`), and motion-shots
  provisions via `bootstrap-owner.ts --username` — which is **one-shot per
  owner**: it throws "differently provisioned staff account already exists"
  against an owner it already linked, and a re-run would fail at sign-in
  anyway (the driver cannot re-derive an earlier run's factor). The fleet's
  posture is now uniformly fail-fast on reused owners, pending the substrate
  decision.
- Still parked (needs the maintainer's substrate yes, unchanged from the
  out-of-scope section): actually running any owner-UI script, and porting
  each script's SQLite-era seeding pass to the chosen store.
