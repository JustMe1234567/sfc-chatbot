# 88: Restore staff visibility of support hours and transcript retention on Settings

Status: ready-for-agent

## What to build

The full-range code review (9ea8fcacc..HEAD) found a silent regression: the
dashboard reorganization that deleted `/dashboard/notifications` moved the
support-hours and transcript-retention forms onto the Settings page behind an
owner-only conditional, and staff lost the read-only visibility they have held
since tickets 09/10 — with no ticket authorizing the loss. The settled posture
is unchanged: the edit APIs are owner-only, owners get the forms, and staff
get a read-only summary. Restore that posture on the Settings page.

- **Settings page** (`src/app/dashboard/settings/page.tsx`):
  - **Owners**: keep exactly what they have — the support-hours form, the
    transcript-retention form (with the last-run line), plus the owner-only
    login-retention and embed-allowlist cards. Nothing changes for owners.
  - **Staff**: render the read-only summary the notifications page used to
    show: the configured support hours via `scheduleSummary` (or the
    "Not configured; visitors receive the general follow-up message." line)
    and the retention period (the configured days, or the
    `DEFAULT_RETENTION_DAYS`-day default wording). No forms, no editable
    controls, no owner-only cards.
  - **Editors**: excluded — neither the summary nor the forms (the page stays
    open to editors for branding and password per tickets 70/82).
- **APIs untouched**: `GET/PUT /api/staff/settings/support-hours` and
  `/api/staff/settings/transcript-retention` remain owner-only
  (`roles: ["owner"]`, tickets 09/10). Embed-allowlist and login-log retention
  remain owner-only. No route changes in this ticket.

## Acceptance criteria

- An owner sees the support-hours and transcript-retention forms on Settings
  as before; the login-retention and embed-allowlist cards remain inside the
  owner-only branch.
- A staff member sees the read-only support-hours and transcript-retention
  summary with the live values, and no forms or owner-only cards.
- An editor sees neither the summary nor the forms on Settings.
- Staff and editor requests to both settings routes are refused (403) on GET
  and PUT; owners pass.
- Focused tests: page-rendering assertions for the three roles (the repo's
  source-reading idiom) and API authorization cases for staff/editor on both
  routes; the suites run on both dialects where the existing suite provides
  parity.
- No GLOSSARY or ADR changes: this restores the documented posture instead of
  redefining it.

## Comments

2026-11-20: Filed from the full-range code review of 9ea8fcacc..HEAD. The
mechanics of the regression: at the review base the notifications page
(`roles: STAFF_ROLES`) showed owners the three delivery-setup forms and staff
a read-only summary (`Support hours` / `Recipients` / `Transcript retention`
`dl`); the range deleted that page, moved `SupportHoursForm`/`RetentionForm`
into `src/app/dashboard/settings/page.tsx` behind `guard.staff.role ===
"owner"`, and no staff-facing rendering of those values survived. The API
owner-only gates predate the branch entirely (tickets 09/10, unchanged
through the range) — only the dashboard's staff visibility regressed, which
is what this ticket restores.

2026-11-20: IMPLEMENTED. `src/app/dashboard/settings/page.tsx` gained a staff
branch after the owner branch: a read-only `alertSummaryGrid` `dl` (the
notifications page's markup, minus the dead Recipients entry — alerts no
longer send) showing the live support hours via `scheduleSummary` (or the
not-configured line) and the retention period (or the
`DEFAULT_RETENTION_DAYS` default wording); no form component renders in that
branch. The owner branch is untouched (forms + login-retention +
embed-allowlist stay inside the single `role === "owner"` conditional), and
editors are structurally excluded: exactly one owner branch, one staff
branch, no editor branch. APIs untouched. New focused file
`tests/settings-visibility.test.ts` (3 tests): owner-branch card containment
with the one-owner-branch/no-editor-branch structural pins; staff-branch
summary pins including the absence of every form component; and staff+editor
GET 403 on both `support-hours` and `transcript-retention` — the coverage
gap that existed before (the old suites pinned PUT refusals and owner GETs,
not staff/editor reads). Suites green on both dialects: SQLite 573 pass / 6
skips, Postgres 576 pass / 3 skips (the skips the restart-persistence file
as always); `npm run check` (hygiene 760 files, typecheck, full suite,
production build) exit 0.
