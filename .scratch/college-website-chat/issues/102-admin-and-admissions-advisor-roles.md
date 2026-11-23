# 102: Replace Owner/Staff/Editor with Admin and Admissions Advisor roles

**Status:** needs-info
**Category:** enhancement (roles + authorization + terminology)
**Priority:** P1
**Source:** Boss feedback relayed by the owner, 2026-11-22 (feature area 1 of 3)
**Related:** [08: Staff access and transfer](08-staff-access-and-transfer.md), [88: Settings visibility](88-restore-staff-settings-visibility.md), [96: Shared banned predicate](96-shared-staff-banned-predicate.md), [98: Rename staging owner username](98-rename-staging-owner-username.md), [70: Branding settings](70-configurable-chatbot-and-dashboard-branding.md), [82: Password-only staff auth](82-remove-totp-mfa-from-all-staff.md), [103: Handoff chat UI](103-admissions-advisor-handoff-chat-ui.md) (terminology parent of its visitor-facing labels)

## Requirements from the feedback (verbatim, preserved)

- Replace Owner, Staff, and Editor with Admin and Admissions Advisor.
- Admin has access to everything.
- Admissions Advisor has access to everything except Analytics, Settings, Logs, and Staff.
- Admissions Advisors can still edit and publish chatbot content.
- Replace product references to "College Staff" with "Admissions Advisor."

## ⚠️ Blocked on owner confirmation — do not implement the migration silently

The existing-role migration is deliberately NOT decided here. The proposed mapping,
flagged for owner confirmation, is:

| Current role value | Proposed role value | Notes |
| --- | --- | --- |
| `owner` | `admin` | 1:1 rename; admin is the superset role ("access to everything"). |
| `staff` | `admissions_advisor` | 1:1 rename; today's staff already has inbox + contacts + analytics but NOT answers editing — under the new model advisors GAIN Answers (see below). |
| `editor` | `admissions_advisor` | **Merge.** Editors collapse into the advisor role. |

The editor merge is a privilege expansion: today editors hold only Answers and
Settings (tickets 70/82/88); as advisors they would also work the Conversations
desk and Visitor contacts (both are part of "everything except Analytics,
Settings, Logs, Staff"). Conversely, advisors LOSE Settings, which every role
can open today. Do not pick a different mapping (e.g. keeping a third role) —
get the owner's confirmation first.

## Current implementation (inspected 2026-11-22)

Role model:

- `src/auth/server.ts:1-8` — `StaffRole = "owner" | "staff" | "editor"` and the
  three permission sets: `STAFF_ROLES` (inbox/operational pages:
  owner+staff), `DASHBOARD_ROLES` (all three), `ANSWER_RULE_ROLES`
  (owner+editor, Answers). Every route and page gates through these.
- `src/api/staff.ts:39-92` — `requireStaff(headers, { roles })` resolves the
  role per request from `staff_members.role` and checks membership in the
  passed list; default is `DASHBOARD_ROLES`.
- Dashboard pages: `logs/page.tsx:19` and `staff/page.tsx:19` are owner-only;
  `answers/page.tsx:28` uses `ANSWER_RULE_ROLES`; `analytics/page.tsx:22`,
  `contacts/page.tsx:49`, `inbox/[id]/page.tsx:28` use `STAFF_ROLES`;
  `settings/page.tsx:40` uses `DASHBOARD_ROLES`; `dashboard/page.tsx:7` has no
  role restriction.
- Dashboard nav: `src/app/dashboard/header.tsx:17-30` — the `NAV` table maps
  each area to roles (`Analytics`/`Visitor contacts`/`Conversations` →
  owner+staff, `Answers` → owner+editor, `Staff` and `Logs` → owner,
  `Settings` → all). `ROLE_LABELS` (line ~47) renders "Owner/Staff/Editor".
- Staff APIs: `api/staff/members/route.ts` — GET roster is `STAFF_ROLES`, POST
  invite is owner-only and validates `role` ∈ {staff, editor} (line ~57);
  disable/reset-password routes are owner-only. `clear-history` route is
  owner-only. `analytics`, `mark-contacted`, `needs-human`, and the
  conversation routes use `STAFF_ROLES`. Settings routes
  (`support-hours`, `transcript-retention`, `login-retention`,
  `embed-allowlist`, `escalation-phrases`, `handoff-options`, `welcome`,
  `branding*`) are owner-only.
- Role strings elsewhere: `conversation-desk.tsx` transfer-target filter
  (`member.role === "owner" || member.role === "staff"`), the owner-only Clear
  history button (`role === "owner"`, desk line ~227), `mayReassign`
  (`role === "owner"`), `src/auth/bootstrapOwner.ts` (seeds `role: "owner"`),
  `src/auth/provision.ts`, `src/auth/renameStaffUsername.ts:78-99` (owner-role
  guard), and `staff/page.tsx` ("This page requires the owner role.",
  disable-button conditions on `member.role !== "owner"`).
- Storage: `staff_members.role` is plain TEXT with **no CHECK constraint**
  (SQLite `migrations/0002_auth_and_mail.sql:16`, Postgres equivalent in
  `migrations/postgres/0001_auth_and_chat.sql`; Supabase Auth does not own the
  role). Sessions do not carry the role — it is re-read per request — so a
  data migration takes effect immediately on the next request.
- Visitor-facing copy containing "College Staff"/"staff" (the terminology
  sweep's targets): widget handoff banner "College staff will reply in this
  chat. Automated answers are paused." (`widget/frame/page.tsx:420`), claimed
  notice "A college staff member has joined the conversation…" (`:430`),
  waiting line "Waiting for a staff member to take over…" (`:502`), clear
  confirm "Staff will keep a record of this chat on their side." (`:262`),
  `HANDOFF_PROMPT_TEXT` "Would you like a staff member to join this chat?"
  (`src/domain/contactRequests.ts:10`), the escalation bot reply
  (`src/domain/hours.ts:116-125`, "A staff member will reply here…"),
  `awaitingStaffResponse` copy (`messages/route.ts:231`), the unknown-question
  offer "Chat with a human", and dashboard desk copy (e.g.
  "Waiting for a staff member to take over this conversation.",
  "invited a staff member" audit label). Tickets 103/104 rework several of
  these same strings — coordinate so the sweep lands once.

## Concerns to address in the design

- **Migration:** one data migration per dialect renaming role values
  (`owner→admin`, `staff→admissions_advisor`, `editor→admissions_advisor` —
  subject to confirmation), plus `bootstrapOwner`, `provisionStaffMember`
  callers, the invite route's role validation, `renameStaffUsername`'s owner
  guard, transfer-target/`mayReassign`/Clear-history role checks, and every
  test fixture/seeding helper that writes `owner`/`staff`/`editor`
  (`tests/auth-helpers.ts`, `tests/setup-auth.ts`, `tests/helpers.ts`,
  `tests/bootstrap-owner.test.ts`, and the role-matrix suites). The role
  column's lack of a CHECK makes the rename simple, but add one CHECK
  constraint for the new values if the owner wants the DB to enforce the
  vocabulary.
- **Compatibility:** `isStaffBanned` (ticket 96) and the Supabase account
  linkage are role-blind and untouched. Historical `audit_log` details embed
  role text (e.g. "owner (role)") and roster rows display `member.role` raw —
  old rows must NOT be rewritten; introduce display labels ("Admin",
  "Admissions Advisor") rather than mutating history. Existing sessions stay
  valid across the rename.
- **Terminology:** GLOSSARY.md needs an update pass — the **Owner** entry's
  avoid-list literally says avoid "administrator" (now the role IS "Admin"),
  **Staff account** names the owner/staff/editor triple, **Conversation**
  says "any administrator who takes over", and **Shared inbox**/**Take
  over**/**Contact request** use "staff" for desk workers. ADR-0004 records
  "owner/staff/editor permissions" and needs an amendment note. The product
  copy sweep ("College Staff" → "Admissions Advisor") must distinguish
  literal references from generic "staff" phrasing (see open decisions).
- **Authorization:** the new permission matrix in code terms — Admin =
  everything (today's owner set, unchanged in effect); Admissions Advisor =
  Conversations, Visitor contacts, Answers (edit AND publish — boss
  requirement; today's staff could not edit rules), welcome/support-hours
  reads per ticket 88's posture, but NOT Analytics, Settings, Logs, or Staff.
  Every `STAFF_ROLES` use site needs re-decision: inbox routes stay advisor-
  inclusive, while the analytics API, roster GET, and clear-history become
  admin-only. The needs-human bell poll (ticket 79) keys off the nav's
  Conversations roles and follows automatically.
- **Data retention:** no retention impact — roles are not visitor data. The
  login log stores usernames, not roles.

## Unresolved product decisions (recorded, not guessed)

1. **Confirm the migration mapping** above, especially the editor→advisor
   merge and its privilege expansion.
2. **Advisors lose Settings** — but Settings hosts the self-service password
   change (ADR-0006: a member's self-service change from Settings revokes no
   sessions) and branding (ticket 70 opened branding to every role). Where do
   advisors change their password after this change? Does branding stay
   advisor-visible, or move admin-only with the rest of Settings?
3. **Admin account management:** today only the bootstrap command creates
   owners and the invite API refuses owner creation. Can an Admin invite or
   disable another Admin, or do Admins come only from bootstrap?
4. **Scope of the terminology sweep:** literally every product string that
   says "College Staff", or also generic "staff" wording ("a staff member
   will reply", "Staff" nav label, "Staff answer chats…")? Ticket 103's
   visitor-facing labels ("Admissions Advisor", "Admissions Chatbot") depend
   on this answer.
5. **Exact display strings** for the two roles and the renamed dashboard
   areas (e.g. does the "Staff" nav item become "Staff accounts", "Team", or
   stay "Staff" as an admin-only area name?).

## Acceptance criteria (once decisions land)

- [ ] `staff_members.role` holds exactly the two confirmed role values on both
      SQLite and Postgres after migration; every existing account maps per the
      confirmed table and retains its password, sessions, and ban flag.
- [ ] An Admin sees and can use every dashboard area and API: Conversations,
      Visitor contacts, Answers (edit + publish), Analytics, Settings, Logs,
      Staff, and the owner-only actions (invite, disable, reset password,
      Clear history, retention and allowlist settings).
- [ ] An Admissions Advisor sees and can use Conversations (claim/reply/
      release/transfer), Visitor contacts (including Mark contacted), and
      Answers (edit + publish) — and receives 403s from Analytics, Settings,
      Logs, and Staff, on both the pages and their APIs.
- [ ] The invite flow creates accounts only in the confirmed role vocabulary,
      gated per decision 3; the bootstrap command seeds the admin role value.
- [ ] No user-visible product string reads "College Staff"; the strings the
      owner confirms in decision 4 read "Admissions Advisor" instead.
      Historical audit rows keep their original wording.
- [ ] GLOSSARY.md and ADR-0004 are amended to the confirmed vocabulary, and
      the role display labels render "Admin"/"Admissions Advisor" on the
      roster, header, and transfer picker.
- [ ] Suites covering the role matrix (staff management, settings visibility
      per ticket 88, answers permissions, desk actions) pass on both dialects
      with the new role values; no behavioral change beyond the confirmed
      matrix.

## Comments

2026-11-22: Filed from boss feedback relayed by the owner. Overlap review:
ticket 08 owns invite/disable mechanics (unchanged semantics, new role
vocabulary); ticket 88 pins the current Settings three-branch posture, which
this ticket supersedes for advisors; ticket 98's rename guard reads the owner
role and needs the new value; no existing ticket covers the role rename or
the Analytics/Settings/Logs/Staff restriction. Numbered 102 (not 101)
deliberately: `101-tx-pooler-weather-and-staging-separation.md` already
exists on the open docs PR #15 branch. Status `needs-info`: the migration
mapping is explicitly flagged for owner confirmation, and decisions 2–5 gate
implementation.
