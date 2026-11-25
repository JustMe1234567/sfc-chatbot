# 102: Replace Owner/Staff/Editor with Admin and Admissions Advisor roles

**Status:** done
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

## Migration mapping — CONFIRMED by the owner (decision session, 2026-11-23)

The mapping below was flagged for owner confirmation when filed; the owner
confirmed it in the 2026-11-23 decision session (Comments, decision 1):

| Current role value | Proposed role value | Notes |
| --- | --- | --- |
| `owner` | `admin` | 1:1 rename; admin is the superset role ("access to everything"). |
| `staff` | `admissions_advisor` | 1:1 rename; today's staff already has inbox + contacts + analytics but NOT answers editing — under the new model advisors GAIN Answers (see below). |
| `editor` | `admissions_advisor` | **Merge.** Editors collapse into the advisor role. |

The editor merge is a privilege expansion: today editors hold only Answers and
Settings (tickets 70/82/88); as advisors they also work the Conversations desk
and Visitor contacts (both are part of "everything except Analytics, Settings,
Logs, Staff"). Conversely, advisors LOSE Settings, which every role can open
today — decision 2 (below) settles where their password change goes.

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
  conversation routes use `STAFF_ROLES`. The settings routes split three
  ways: `support-hours`, `transcript-retention`, `login-retention`,
  `embed-allowlist`, and `settings/analytics` are owner-only;
  `escalation-phrases`, `handoff-options`, and `welcome` use
  `ANSWER_RULE_ROLES` (owner + editor) and back the Answers area's Handoff
  Phrases, Handoff Options, and Welcome Message tabs
  (`src/app/dashboard/answers/answers-workspace.tsx`) — chatbot content,
  not Settings-page configuration; the three `branding/*` routes use
  `DASHBOARD_ROLES` (every role).
- The Staff page (`src/app/dashboard/staff/page.tsx`) is an owner-only
  roster: `account-form.tsx` ("Create a staff account" — Name, Username,
  Password, and a Role picker offering "Staff (inbox, replies)" /
  "Editor (answers only)"), then per-member cards carrying
  `credential-actions.tsx` (Reset password) and `disable-button.tsx` for
  every active non-owner account other than the acting one. Account
  creation is already direct — the admin sets the username and initial
  password, and nothing is mailed (ADR-0004).
- The Settings page (`src/app/dashboard/settings/page.tsx`) composes
  `<PasswordSettings />` and `<BrandingSettings />` for every role (the
  password change calls the auth handler's `change-password`,
  `src/auth/supabase-provider.ts:355`, which has no role gate), the
  support-hours/retention/login-retention/allowlist forms for owners only,
  and ticket 88's read-only support-hours/retention summary for staff only.
  The dashboard front door (`src/app/dashboard/page.tsx`) sends editors to
  Answers and every other role to the inbox.
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
- Visitor-facing copy containing "College Staff"/"staff" (kept verbatim
  under the owner's internal-only rule — amendment 3; ticket 103 replaces
  the banner and adds the new "Staff" strings): widget handoff banner "College staff will reply in this
  chat. Automated answers are paused." (`widget/frame/page.tsx:420`), claimed
  notice "A college staff member has joined the conversation…" (`:430` —
  excepted from the sweep by the owner's 2026-11-24 amendment, see
  Comments),
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
  (`owner→admin`, `staff→admissions_advisor`, `editor→admissions_advisor`),
  plus `bootstrapOwner`, `provisionStaffMember`
  callers, the invite route's role validation, `renameStaffUsername`'s owner
  guard, transfer-target/`mayReassign`/Clear-history role checks, and every
  test fixture/seeding helper that writes `owner`/`staff`/`editor`
  (`tests/auth-helpers.ts`, `tests/setup-auth.ts`, `tests/helpers.ts`,
  `tests/bootstrap-owner.test.ts`, and the role-matrix suites). The role
  column's lack of a CHECK makes the rename a plain UPDATE; no CHECK is
  added (see Comments, decision 2 — a technical default the owner may
  overturn).
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
  copy sweep ("College Staff" → "Admissions Advisor") applies to
  dashboard-facing references only — visitor chat copy keeps its "staff"
  wording per the owner's 2026-11-24 internal-only rule (amendment 3).
- **Authorization:** the permission matrix in code terms. **Admin** =
  everything (today's owner set, unchanged in effect). **Admissions
  Advisor** = Conversations, Visitor contacts, and the Answers area in full —
  rules (edit AND publish — boss requirement; today's staff could not edit
  rules) plus the Handoff Phrases, Handoff Options, and Welcome Message
  settings, which are chatbot content (decision 2). Advisors get **no**
  Settings page: branding becomes admin-only (its three routes move from
  `DASHBOARD_ROLES` to admin), and ticket 88's read-only
  support-hours/retention summary leaves with the page. Their self-service
  password change moves to a surface both roles can reach (decision 2).
  Advisors are refused Analytics, Settings, Logs, and Staff. Every
  `STAFF_ROLES` use site needs re-decision: inbox routes stay
  advisor-inclusive, while the analytics routes/page, the roster GET, and
  clear-history become admin-only. The needs-human bell poll (ticket 79)
  keys off the nav's Conversations roles and follows automatically.
- **Supersessions this ticket records:** ticket 70's "every dashboard role
  may configure branding" (now admin-only), ticket 82's password form on
  Settings (now outside it), and ticket 88's staff read-only summary (gone
  with the advisor's Settings page).
- **Data retention:** no retention impact — roles are not visitor data. The
  login log stores usernames, not roles.

## Product decisions

All five resolved by the owner in the 2026-11-23/24 decision session —
details in the dated Comments entries and in each item below.

1. **Confirm the migration mapping** above, especially the editor→advisor
   merge and its privilege expansion.
   **RESOLVED 2026-11-23 — confirmed as proposed (two-role merge).**
2. **Advisors lose Settings** — but Settings hosts the self-service password
   change (ADR-0006: a member's self-service change from Settings revokes no
   sessions) and branding (ticket 70 opened branding to every role). Where do
   advisors change their password after this change? Does branding stay
   advisor-visible, or move admin-only with the rest of Settings?
   **RESOLVED 2026-11-23 (recorded 2026-11-24) — option A:** the password
   change moves out of Settings to a surface both roles can reach; branding
   becomes admin-only. Stated consequence: ticket 88's read-only
   support-hours/retention summary disappears for advisors, since it lived
   on the Settings page; relocating it is out of scope.
3. **Admin account management:** today only the bootstrap command creates
   owners and the invite API refuses owner creation. Can an Admin invite or
   disable another Admin, or do Admins come only from bootstrap?
   **RESOLVED 2026-11-24 — option A, reworded by the owner:** "no staff
   invites, admin can create the advisor accounts and can reset their
   passwords". Admins come only from the bootstrap command; the Staff page
   directly creates Admissions Advisor accounts and resets their passwords.
   **Follow-up 3b (same day) — keep Disable:** the Admin also disables
   advisor accounts, exactly as today.
4. **Scope of the terminology sweep:** literally every product string that
   says "College Staff", or also generic "staff" wording ("a staff member
   will reply", "Staff" nav label, "Staff answer chats…")? Ticket 103's
   visitor-facing labels ("Admissions Advisor", "Admissions Chatbot") depend
   on this answer.
   **RESOLVED 2026-11-24 — option A: every user-visible string is reworded;
   internal names stay.**
5. **Exact display strings** for the two roles and the renamed dashboard
   areas (e.g. does the "Staff" nav item become "Staff accounts", "Team", or
   stay "Staff" as an admin-only area name?).
   **RESOLVED 2026-11-24 — option A:** role labels "Admin" /
   "Admissions Advisor"; the Staff area is relabeled "Staff accounts"
   (address `/dashboard/staff` unchanged); the login page reads
   "Dashboard sign-in" with admin-vocabulary hint lines.

## Acceptance criteria

- [ ] `staff_members.role` holds exactly `admin` and `admissions_advisor` on
      both SQLite and Postgres after migration; every existing account maps
      owner→admin and staff/editor→admissions_advisor (the two-role merge),
      and retains its password, sessions, and ban flag.
- [ ] An Admin sees and can use every dashboard area and API: Conversations,
      Visitor contacts, Answers (edit + publish), Analytics, Settings
      (password, branding, and every configuration form), Logs, Staff, and
      the admin-only actions (create advisor accounts, reset passwords,
      disable accounts, Clear history, retention and allowlist settings).
- [ ] An Admissions Advisor sees and can use Conversations (claim/reply/
      release/transfer), Visitor contacts (including Mark contacted), and
      the whole Answers area — answer rules (edit + publish) plus the
      Handoff Phrases, Handoff Options, and Welcome Message settings and
      their APIs.
- [ ] An Admissions Advisor has no Settings: the page and every `settings/*`
      and `branding/*` staff API answer 403, the Settings nav item is
      absent, branding is editable by Admins only, and ticket 88's read-only
      support-hours/retention summary no longer renders for advisors.
      Analytics, Logs, and Staff likewise answer 403 on page and API, with
      no nav items.
- [ ] An Admissions Advisor can change their own password without opening
      Settings: the control is reachable from the dashboard chrome on every
      page for both roles and uses the existing `change-password` auth
      endpoint (ADR-0006 — it revokes no sessions).
- [ ] The dashboard front door (`/dashboard`) sends both roles to the
      inbox; the editor-only redirect to Answers leaves with the role.
- [ ] Only the bootstrap command creates Admins: `npm run bootstrap:owner`
      seeds the `admin` role, the dashboard offers no way to create an
      Admin, and Admin accounts still cannot be disabled or password-reset
      from the dashboard.
- [ ] From the Staff page an Admin directly creates an Admissions Advisor
      account — name, username, and an initial password the Admin sets, with
      no role picker and no "staff" or "invite" wording — resets an
      advisor's password (revoking that advisor's sessions, as today), and
      disables an advisor account (signed out everywhere and blocked from
      signing in, as today). Advisors are refused (403) on all three actions.
- [ ] Dashboard-facing strings are reworded to the confirmed vocabulary:
      role labels ("Admin"/"Admissions Advisor"), nav areas ("Staff
      accounts"), the login page ("Dashboard sign-in" plus admin-vocabulary
      hints), dashboard error messages and hints, screen-reader labels, and
      the roster display ("Admin" / "Admissions Advisor" / "disabled" /
      "active"). Visitor-facing chat copy keeps its human references as
      "Staff" wording — the owner's standing rule (2026-11-24): "Admissions
      Advisor is only internal." The standing strings stay verbatim — "A
      college staff member has joined the conversation and will reply
      here.", "Staff will keep a record of this chat on their side.",
      "Would you like a staff member to join this chat?", "Yes, chat with
      staff", "Chat with a human", and the escalation replies in
      `hours.ts` ("A staff member will reply here…", "Staff are on duty
      until…", "…college staff team…") — and ticket 103's new
      visitor-facing strings read "Staff will reply" and the "Staff" sender
      label. (The bot's "Admissions Chatbot" label is branding, not a human
      reference, and stands.) Neutral phrasing ("our team") is unchanged.
      Historical records — stored bot and visitor messages, and old audit
      rows — keep their original wording.
- [ ] Internal names are unchanged: `StaffRole`, `requireStaff`,
      `/api/staff/*`, `/dashboard/staff`, `/api/staff/members` and its
      create/reset/disable routes, the `staff_members` table, the audit
      action ids (`staff_invited`, `staff_created`, …), and the stored
      values `messages.role = "staff"` and
      `conversations.state = "awaiting_staff"` (both locked by CHECK
      constraints on SQLite and Postgres — verified) stay exactly as they
      are. No migration touches them.
- [ ] The role labels render "Admin"/"Admissions Advisor" on the roster,
      sidebar identity, and transfer picker; the Staff area's nav item,
      page title, and document title read "Staff accounts" with the route
      `/dashboard/staff` unchanged; the login page reads "Dashboard
      sign-in" with "Accounts are created by an admin" and "Contact an
      admin if you forget your password" as its hint lines.
- [ ] GLOSSARY.md and ADR-0004 are amended to the confirmed vocabulary —
      the Owner entry's "avoid administrator" note, the Staff account
      triple, and "any administrator who takes over" reworked to the
      Admin/Admissions Advisor model, with historical records untouched.
- [ ] Suites covering the role matrix (staff management, settings visibility,
      answers permissions, desk actions) are re-pinned to the confirmed
      matrix and pass on both dialects; no behavior changes beyond it.

## Comments

2026-11-23: DECISION SESSION (owner). Decision 1 — role migration mapping:
CONFIRMED as flagged. Owner's words: "Roles should be Admin and Admissions
Advisor instead of Owner, Staff, and Editor" — the two-role merge
(owner→admin, staff→admissions_advisor, editor→admissions_advisor). The
editor merge's privilege expansion (former editors gain Conversations,
Visitor contacts, and Mark contacted; advisors gain Answers edit+publish) is
accepted as part of the replacement. The mapping section above is marked
confirmed, and AC 1 now states the mapping concretely.

2026-11-24: DECISION SESSION (owner). Decision 2 — advisors and Settings:
**option A**, chosen 2026-11-23. The self-service password change moves out
of Settings to a surface both roles can reach; branding becomes admin-only
with the rest of the page. Before recording, the owner was shown that
ticket 88's read-only support-hours/retention summary disappears for
advisors along with the page, and did not ask for it to be relocated
(relocating it would be new scope). Verifying against the code while
recording exposed two errors in this ticket's own filed text, now
corrected: (1) "Current implementation" wrongly listed
`escalation-phrases`, `handoff-options`, and `welcome` as owner-only
Settings routes — they are gated by `ANSWER_RULE_ROLES` and back the
Answers area's Handoff Phrases, Handoff Options, and Welcome Message tabs,
i.e. chatbot content that advisors keep; (2) the Authorization concern
assumed advisors would retain a support-hours read, which a missing
Settings page cannot provide. The ticket now carries the real matrix, a
Supersessions bullet (tickets 70, 82, 88), and ACs for the Answers-area
content settings, the no-Settings refusals, and the relocated password
change.

**Two technical defaults applied without a dedicated question —
the owner was told in the session and may overturn either:** (a) the
dashboard front door sends both roles to the inbox (the operational role's
existing landing; the editor→Answers redirect leaves with the role);
(b) no CHECK constraint is added to `staff_members.role` — the rename is a
plain UPDATE, matching today's unconstrained column and AGENTS.md's rule
against unrequested schema changes.

2026-11-24: DECISION SESSION (owner). Decision 3 — Admin account
management: **option A, reworded by the owner** — "A. but no staff invites,
admin can create the advisor accounts and can reset their passwords".
Recorded as: Admins exist only through the bootstrap command (no dashboard
control creates, disables, or password-resets an Admin); on the Staff page
an Admin directly creates Admissions Advisor accounts and resets their
passwords; the words "staff" and "invite" leave the account flow, and the
form's Role picker goes with them, advisor being the only creatable role.
(Today's form already creates accounts directly, the admin setting username
and password, with nothing mailed — ADR-0004 — so this is a wording and
role-picker change, not a new mechanism.) **Open follow-up 3b:** the
owner's answer named create + reset only; whether the Admin also keeps
**disabling** advisor accounts — today's Disable button, the one-click way
to cut off a departed advisor — is asked before the disable AC is written.

2026-11-24: DECISION SESSION (owner). Follow-up 3b — disabling advisor
accounts: **keep Disable** (option A). The Admin creates advisor accounts,
resets their passwords, and disables them — today's three controls under
the new vocabulary; disabling still signs the advisor out everywhere and
blocks sign-in. Decision 3 is complete: its ACs and the Admin AC's action
list are final.

2026-11-24: DECISION SESSION (owner). Decision 4 — scope of the wording
sweep: **option A.** Every user-visible string is reworded to the new
vocabulary; internal names stay. The string census (grep-verified before
asking): visitor chat copy ("College staff will reply…", "A college staff
member has joined…", "Would you like a staff member to join this chat?",
"Yes, chat with staff", "Staff are on duty until…", "Staff will keep a
record of this chat", "Waiting for a staff member to take over…", and the
literal "college staff team" in `hours.ts:108`), dashboard copy (role
labels, "Nothing is waiting for staff", "Closed by staff", transfer
errors, "a former staff member"), the login page ("Staff sign-in", "Staff
accounts are created by an owner", "Contact an owner if you forget your
password"), and aria-labels ("Options to reach our staff") — all reworded.
Internal names stay: `requireStaff`/`StaffRole`, `/api/staff/*`,
`/dashboard/staff`, `staff_members`, the audit action ids, and the stored
values `messages.role = "staff"` and `conversations.state =
"awaiting_staff"` — both CHECK-constrained on SQLite and Postgres
(0001/0002 migrations, verified). Neutral phrasing that names no role
("our team", "a human") keeps its wording. The old copy AC is replaced by
a reworded-strings AC and an internal-names-stay AC. Login-page and
nav-area wording follow decision 5's strings where they overlap.

2026-11-24: DECISION SESSION (owner). Decision 5 — display strings:
**option A.** Role labels "Admin"/"Admissions Advisor" (feedback-fixed);
the Staff area is relabeled **"Staff accounts"** — nav item, page title,
document title — with `/dashboard/staff` unchanged; the login page reads
**"Dashboard sign-in"** with hint lines "Accounts are created by an admin"
and "Contact an admin if you forget your password". The GLOSSARY/ADR AC
splits: display-string coverage moves into this AC; the doc updates stay
their own AC below.

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

2026-11-24: DECISION SESSION COMPLETE for this ticket. All five decisions
resolved (1: mapping confirmed; 2: option A — password move + branding
admin-only; 3/3b: admins manage advisors only, create + reset + disable;
4: visible strings only; 5: option A strings). Status
`needs-info` → **`ready-for-agent`**: the ticket is fully specified with
testable ACs; implementation can start. The AC heading drops its
"(once decisions land)" qualifier; a GLOSSARY/ADR AC was split back out of
the display-strings AC. Ticket 103 depends on this ticket's confirmed
vocabulary for its visitor-facing labels; ticket 104's Mark contacted gate
follows the renamed roles.

2026-11-24: AMENDMENT (from ticket 103's decision session). The owner
deliberately excepted one string from decision 4's sweep: the widget's
advisor-joined notice keeps today's exact sentence — "A college staff
member has joined the conversation and will reply here." The conflict with
the sweep and with the boss's "replace product references to 'College
Staff'" requirement was shown to the owner (two readings offered); they
chose the verbatim keep. The reworded-strings AC and the
current-implementation census line now carry the exception so this ticket
and ticket 103 do not hand an implementer contradictory requirements.
Every other sweep target stands; a second exception followed the same day
(next entry).

2026-11-24: AMENDMENT 2 (from ticket 103's decision session, decision 3).
A second deliberate exception: the visitor widget's advisor-message sender
label reads "Staff" — an explicit owner override of the feedback's quoted
'Label advisor messages "Admissions Advisor."' — with bot messages still
labeled "Admissions Chatbot" (ticket 103 pins both strings). As with
amendment 1, the conflict with the sweep and the feedback's wording was
shown to the owner first; they picked the override. The AC above lists both
exceptions; every other sweep target stands.

2026-11-24: AMENDMENT 3 (from ticket 103's decision session, decision 4).
While answering the waiting-notice wording the owner set a standing rule:
**"Admissions Advisor is only internal."** Visitor-facing human references
say "Staff"; the "Admissions Advisor" vocabulary appears only in
dashboard-facing copy. This re-scopes decision 4's sweep and absorbs
amendments 1–2 as instances of the same rule: the visitor chat copy in the
census keeps its "staff" wording verbatim, ticket 103's new visitor-facing
strings read "Staff will reply" and the "Staff" sender label, and the
reworded-strings AC above is rewritten to the rule (dashboard-facing
reworded; visitor-facing human references stand). The bot's "Admissions
Chatbot" label is branding, not a human reference, and stands in the
visitor chat. The feedback's "Replace product references to 'College
Staff'" requirement is scoped by this rule to dashboard-facing references;
the historical decision-4 comment above records the pre-rule census as
decided that day.

2026-11-26: **Implemented.** The two-role model shipped in one slice on
`codex/ticket-102-admin-and-advisor-roles` (base b2f57c5a7), TDD at three
seams: the real migration runners, the route handlers under signed-in
sessions, and the suite's source-contract convention for pages and copy.

**Migration.** `migrations/0023` (SQLite) and `migrations/postgres/0013`
are one data update each — `owner→admin`, then `staff` and
`editor→admissions_advisor` — with no CHECK added to `staff_members.role`
(the disclosed technical default). `tests/role-migration.test.ts` drives
the real runners on both dialects: accounts seeded with the three legacy
values map exactly; identity, credential linkage, ban flag, a desk
assignment, and its audit attribution survive on the same staff ids;
sessions opened before the migration keep working; each migrated account
hits the full 11-endpoint matrix with the confirmed statuses; a disabled
account stays disabled; a second boot replays nothing.

**Authorization.** `StaffRole` is now `admin | admissions_advisor`; the
three role sets collapse to admin-inclusive pairs and gain
`staffRoleLabel` (the one dashboard-facing name map). Admin-only: the
roster GET, member create/reset/disable, clear-history, every
`settings/*` route, all three `branding/*` routes (superseding ticket
70's every-role posture), analytics, and logs. Advisor-inclusive:
conversations (claim/reply/release/transfer/mark-contacted — the
release/reply/transfer admin override now keys on `admin`), answer rules,
and the three Answers-area content settings. The desk's transfer-target
filter admits both roles via `STAFF_ROLES`; `activeInboxMember` matches
the same set. Analytics lost its in-page role split (admin-only now), and
the needs-human bell's poll follows the Conversations nav row, so
advisors now receive it.

**Account lifecycle.** `npm run bootstrap:owner` seeds the `admin` role
and reports "Admin account created" (command name unchanged per AC); the
members POST takes only advisors — the form sends no role, a forged role
value (any of admin/owner/staff/editor) answers 400 — and Admin targets
refuse reset and disable exactly as owners did. The Staff accounts page
(superseding ticket 88's posture along with the whole Settings page)
renders stored roles through `staffRoleLabel` and keeps disable/reset off
Admin rows; the create form drops the Role picker and the staff/invite
vocabulary. The guarded username rename (ticket 98) now demands the
`admin` role and counts exactly one active admin.

**Terminology.** Dashboard-facing copy reworded: login page reads
"Dashboard sign-in" with the two decision-5 hint lines; nav row "Staff
accounts" (route unchanged); desk copy ("Nothing is waiting for an
advisor.", "Closed by an advisor", the takeover hints, transfer errors,
conflict copy, "a former advisor"), audit display labels (advisor
wording; stored action ids untouched), page refusals ("the admin role" on
admin-only pages; neutral "an authorized session" on shared pages), and
the analytics hints. The password form's hint now says "admin-issued
reset". Visitor-facing chat copy kept verbatim per the standing rule —
verified by diff against the base: the widget banner, joined notice,
waiting line, clear confirm, handoff prompt, "Yes, chat with staff", and
the `hours.ts` escalation replies are byte-identical; `messages.role =
"staff"` and `awaiting_staff` are untouched.

**Password relocation (decision 2).** New `PasswordDialog` in the
sidebar's identity block renders the unchanged `PasswordSettings` form
(same `change-password` endpoint, same no-revocation contract) from
every dashboard page for both roles; like the bulk revoke it has no icon
form and hides in the compact rail. The Settings page no longer renders
it, and ticket 88's read-only summary left with the page. The front door
(`/dashboard`) redirects both roles to the inbox unconditionally.

**Docs.** GLOSSARY.md: the Owner entry became **Admin** (bootstrap-only,
avoid-list updated) with a new **Admissions Advisor** entry recording the
internal-only rule and the merge; **Staff account** and **Conversation**
reworked. ADR-0004's status and opening paragraph carry the ticket-102
amendment. `migrations/README.md` gained the 102→0023/0013 row.

### Verification

- `tests/role-migration.test.ts` — green on SQLite and Postgres (the
  full matrix inside the migration test itself).
- `tests/staff-management.test.ts` 25/25 (create without a role field,
  forged roles 400, advisor 403 on create/reset/disable, Admin
  un-resettable/un-disableable, admin claim overrides, roster labels,
  chrome password pins, front-door pin) — both dialects.
- Full suite: SQLite **72 files / 621 passed / 7 skipped**; Postgres
  **73 files / 625 passed / 3 skipped** (the skips are the
  SQLite-restart-specific tests). Zero failures on either dialect.
- `tsc --noEmit` clean; hygiene 796 tracked files pass; production build
  exit 0.

### Status

COMPLETE — all fourteen acceptance criteria pass. Status set to `done`.
Not pushed; no PR opened — review and merge are the owner's steps.

2026-11-26: **Review amendment — `/code-review b2f57c5a7` over the full
range (3 commits), both axes. One hard standards violation, fixed with
three smaller in-scope findings; the rest parked with dispositions.**

- **FIXED — stale "owner" refusal (standards axis, hard):** the Logs
  page still rendered "This page requires the owner role." — the last
  user-visible legacy string, breaching the reworded-strings AC
  (dashboard error messages) and the glossary's new avoid-list. Reworded
  to "the admin role"; the page's stale owner comment updated too.
- **FIXED — Answers-area hints (spec axis):** three user-visible hints
  still said "staff" (answers intro "go straight to staff", the handoff
  options "sends the visitor straight to staff", the escalation phrases
  "goes to staff") — dashboard-facing copy the sweep covers; reworded to
  advisor wording.
- **FIXED — transfer picker role labels (spec axis, partial AC):** the
  picker rendered names only; the desk now resolves each target's
  `staffRoleLabel` and the option renders "Name · Admissions Advisor",
  with a source pin on the pairing.
- **FIXED — dead conditional (standards axis):** AnalyticsSettingsForm's
  `settings ?` guard could never fire after the admin-only simplification;
  removed. The members POST also now refuses a non-string `role` outright
  instead of silently defaulting it to advisor.
- **PARKED — identical role-set arrays (standards axis, Duplicated
  Code):** `STAFF_ROLES`/`DASHBOARD_ROLES`/`ANSWER_RULE_ROLES` are now the
  same list; the three names carry the per-area semantic intent the
  ticket's authorization model describes, and callers keep expressing
  *which kind of area* they gate. Collapse them if a future ticket ever
  needs one set.
- **PARKED — `staffRoleLabel` lives in `auth/server` (standards axis,
  Mysterious Name adjacent):** a client-consumed label helper inside a
  module named "server". No server-only imports are involved, the file is
  already the shared role vocabulary, and relocating it is churn tickets
  103/104 would immediately follow; leave until a second vocabulary home
  appears.
- **PARKED — unticked AC checkboxes (spec axis, bookkeeping):** the
  tracker's convention marks completion via the `Status:` line (ticket 91
  is `done` with its boxes unticked), so the boxes stay.
- **PARKED — 78-file scatter (standards axis, Shotgun Surgery):**
  inherent to a deliberate vocabulary + permission-matrix replacement;
  every hunk traces to a ticket AC or decision (spec axis: no scope creep
  found).

Re-verification after the fixes: full SQLite suite 72 files / 622 passed
/ 7 skipped; the touched suites re-run green on Postgres (56 tests);
typecheck, hygiene (800 files), and the production build all pass.

Reviewed through: abc70354e
