# 85: Route the site root to the dashboard

**Status:** ready-for-human  
**Category:** enhancement  
**Priority:** P3  
**Blocked by:** none  
**Related:** [72: Use cog icon for settings navigation](72-use-cog-icon-for-settings-navigation.md) — dashboard shell polish on the same surface

## Context

The deployed site root served a static notice — a "Springfield College
chatbot" heading explaining that the widget lives on the college WordPress
site, with a hyperlink to the local embed demo at
`/demo/wordpress-test-page.html`. The actual application lived behind
`/dashboard`, so anyone arriving at the deployed root (staff included) hit a
dead-end blurb and had to know the real path. This ticket retrospectively
records user-authorized reconciliation work implemented in commit
`1bbbd427a` before the ticket existed.

## Desired behavior

1. `/` routes users to the staff dashboard: the root page is a server-side
   `redirect("/dashboard")`, so signed-out visitors chain straight through
   `/dashboard`'s own authentication redirect to the login screen and
   signed-in staff land on the desk.
2. The WordPress embed demonstration remains available at its dedicated URL,
   `/demo/wordpress-test-page.html` (the static demo file in `public/demo/`
   is untouched).
3. Widget and dashboard routes otherwise remain unchanged.

## Acceptance criteria

- [x] `/` serves a redirect to `/dashboard` (`src/app/page.tsx` returns
  `redirect("/dashboard")` from `next/navigation`).
- [x] The embed demo remains reachable at `/demo/wordpress-test-page.html`;
  `public/demo/wordpress-test-page.html` is not part of the change.
- [x] Widget and dashboard routes are otherwise unchanged — the commit's
  entire diff is the one `src/app/page.tsx` file (6 insertions, 10
  deletions); no other route, layout, or middleware was touched.

## Out of scope

Changing the dashboard's own routing or authentication redirect, the login
screen, the widget embed or its loader, the demo page's content, and any
public API. No test or schema changes.

## Implementation record

Commit `1bbbd427a` (2026-11-19, "feat(app): route the site root to the
dashboard"): `src/app/page.tsx` only — the static blurb replaced with a
documented server-side redirect; the doc comment records the sign-out chain
and the demo's dedicated URL.

## Comments

2026-11-19: Filed retrospectively — user-authorized reconciliation work
already implemented before the ticket existed; this file records it for
final review. Verification: the committed diff was read and matches every
criterion (single file, redirect, demo carve-out documented in-code); the
demo file exists at `public/demo/wordpress-test-page.html` and its last
change (cdfd34f90, 2026-10-28) predates the commit; the production build on
a tree containing the commit compiles the redirect (part of the
filing-session check run).
