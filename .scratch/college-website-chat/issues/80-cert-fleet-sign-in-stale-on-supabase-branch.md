# 80: Cert/shot fleet's owner sign-in is stale on the Supabase auth branch

**Category:** chore
**Status:** ready-for-agent

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
- [ ] The standalone certs' sign-in blocks match the current login/enroll
      pages.
- [ ] Enrollment wipes no longer reference dead Better-Auth-era tables, or
      are explicitly reframed with a comment explaining what they wipe now.
- [ ] No application source changes; scripts only.
