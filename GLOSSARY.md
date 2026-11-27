# College Website Chat

Terms used for visitor questions and staff handoff on the college website.

## Language

**Visitor**:
A member of the public using the college website chat. The first release does not handle student account questions.

**Answer rule**:
An approved question pattern and its associated response about the college, maintained by staff. A visitor question is unknown when no answer rule applies.

**Escalation**:
A request for staff help raised when a visitor accepts the human-chat offer after an unknown question, immediately when their message matches a configured handoff phrase, or when the visitor clicks a configured click-to-handoff option. Bot replies pause while the request is open.

**Click-to-handoff option**:
A staff-configured suggestion ("I want to speak to someone in admissions", by default) that the widget offers as a clickable button on the fresh chat and again after bot answers (ticket 67). Clicking one records its label as the visitor's words, acknowledges the chosen topic truthfully, and escalates through the existing path exactly once — deliberately bypassing any matching answer rule. Only the click carries that meaning: typing the same wording keeps normal answer matching unless it was separately configured as a typed handoff phrase. Editors add, edit, and remove options in the Answers admin area's Handoff Options tab.

**Human takeover**:
The point in a conversation when a named staff member claims it and begins replying to the visitor in the same chat.

**Shared inbox**:
The queue of escalated conversations available to authorized staff until one person claims each conversation. On the conversation desk it appears as the Incoming section.

**Conversation desk**:
The staff dashboard's two-pane view of the day's work: a conversation list on the left (Incoming and Active sections, with History a tab away) and the selected transcript with its reply controls on the right.

**Activity**:
Whether a conversation is still live on the desk, judged from its latest meaningful message — a visitor or staff message; polling, presence, and page views do not count. A conversation leaves the active lists exactly 24 hours after its latest meaningful message and waits in History, transcript kept. One exception (ticket 104): a conversation with an open email or phone contact request never leaves the active lists, however quiet — it stays pinned in Active, with the Contact Me status and Mark contacted available, until an advisor marks the request contacted, after which the ordinary 24-hour rule resumes. The exception is a desk-visibility rule only: the visitor refusal boundary and the retention sweep keep reading the plain inactivity window, so a pinned conversation's records still age out on the usual clock.

**Attention**:
The in-dashboard signal that a conversation has something new for staff — a fresh escalation or a visitor message while staff help is active. Viewing, replying, or claiming clears it; it never duplicates while standing.

**Status treatment**:
The conversation desk's three-tier coloring (ticket 44, re-colored in ticket 66): Needs human (an escalation waiting for a claim, green) outranks New message (standing attention, red) outranks Active (a live bot or claimed chat with nothing unread, yellow). Every tier pairs its color with visible text or a dot carrying an accessible name, applied consistently to list rows, badges, counts, and the selected conversation's header. History rows are the archive and carry no treatment.

**Notification sound**:
The desk's alert (tickets 44, 77, 106): when a conversation needs staff, the owner-chosen "Marimba greeting" ringtone — a synthesized triangle-wave arpeggio, no audio asset — rings continuously while any live desk conversation sits in Needs human: each play sounds ≈ 1.6 seconds and the next play starts 0.5 seconds after the previous play's sounded end, stopping the moment the state clears or sounds are muted; unmuting with a conversation still waiting restarts the ring. Ordinary new-message attention keeps 44's behavior: one soft chime cue per attention episode per staff browser, anchored at the instant the episode began. Muting is per-browser and never hides the visual indicators; audio blocked before the first interaction plays one late cue instead of a backlog.

**Needs-human bell**:
The dashboard-wide visual indicator (ticket 79): a bell on the Conversations navigation item, shown exactly while at least one live desk conversation sits in Needs human and hidden the moment the state clears. It carries no count — presence is the message — wears the Needs-human green from the status treatment (the bright graphic variant, since the rail is dark), and the navigation item's accessible name says needs human while it shows. It is visible from every dashboard page, in the expanded rail, the compact icon rail, and the mobile drawer.

**Take over**:
The staff-facing label for claiming (ticket 45) — the atomic assignment of a waiting conversation to exactly one staff member. Product copy says Take over/Taking over; the domain keeps claim/claimed in state values, API paths, and audit action ids.

**Clear conversation**:
The visitor's action to end the current chat and start a fresh one. Staff keep the old transcript in History under the retention policy; the visitor's credential and any unused return link are revoked immediately, and the fresh chat asks for contact details again before anything can be sent.

**Welcome message**:
The greeting shown at the top of a fresh chat once the visitor's contact details are accepted, before they ask anything. It is presentation-only — rendered locally, never stored as a message, never part of the staff transcript — and its wording is a staff-published setting with a built-in default; opening the widget creates no conversation.

**Contact details**:
The visitor's full name, email address, and phone number, required before every new chat (ticket 66). The widget asks for them first, and the server refuses visitor messages and topic choices on any conversation without accepted details — including conversations from before the requirement, which staff still read under the fallback name "Visitor". They are stored on the conversation and removed with it. They stay **temporary** for chat labeling until the visitor creates a **contact request** (ticket 69), which promotes all three into the saved contact list.

**Contact request**:
A visitor's explicit ask to be reached (ticket 69), in one of three media: **Chat** rides the existing waiting-for-staff flow (Take over completes it), while **Email** and **Phone** leave the bot active behind a persistent red **Contact Me** desk status that staff clear with **Mark contacted** — viewing the transcript never clears it. A clicked Handoff Option or typed Handoff phrase asks the persisted two-action confirmation before anything happens; exactly one request may be open per conversation, one row per conversation shows the latest medium in Visitor contacts, and earlier requests stay in the conversation's request history. Requests leave with the conversation under every deletion path.

**Conversation**:
The message history shared by a visitor, the bot, and the Admin or Admissions Advisor who takes over.

**Staff account**:
The named dashboard membership of a college employee. An admin assigns its username, initial password, and Admin or Admissions Advisor role — advisor accounts from the Staff accounts page, Admins only through the bootstrap command; the password alone admits the dashboard (ticket 82 removed the second factor).

**Admin**:
The highest-privilege role, responsible for security-sensitive dashboard configuration and staff administration. Admins exist only through the bootstrap command and cannot be created, disabled, or password-reset from the dashboard. (The role was named Owner before ticket 102; historical records keep the old name.)
_Avoid_: Superadmin, administrator, Owner (historical)

**Admissions Advisor**:
The dashboard's operational role: conversations, visitor contacts, and the whole Answers area (edit and publish), excluding Analytics, Settings, Logs, and Staff accounts. Internal dashboard vocabulary only — visitor-facing chat copy says "Staff" (owner's standing rule, 2026-11-24). The role merged the former staff and editor roles (ticket 102).

**Staff credential reset**:
An owner-issued password reset for an existing staff account. It revokes every session; the member signs back in with the new password.

**Login log**:
The complete owner-held record of dashboard sign-in attempts (ticket 81): every success, failure, and blocked attempt, each with the attempted username, outcome, reason, client IP, browser user agent, and time. Owners may delete entries individually, in checkbox-selected ranges, or all at once; the login retention period removes the rest.

**Suspicious login**:
A login event flagged for owner review because it matches a suspicious pattern — repeated password failures against one staff account from one IP, a successful sign-in from an IP that account has never used before, or repeated attempts against usernames that don't exist or belong to disabled accounts. Flagging is detection only: it never blocks, sounds, or locks anything; flagged events surface in the Logs tab's suspicious view.

**IP block**:
The temporary rejection of sign-in attempts that use a non-staff username from one client IP (ticket 81): ten such failures within a rolling ten minutes block that IP's non-staff-username attempts (unknown or disabled accounts) for one hour, with no manual release. Attempts with a valid staff username are never blocked — a correct password still signs in from a blocked IP.

**Visitor session**:
The temporary identity that lets one public visitor resume and read their own conversation without creating a staff account.

**Embed allowlist**:
The owner-managed set of website origins whose every page may host the chatbot widget. Production chat is available only inside an allowed website; local development origins and standalone testing are permitted separately and never become production entries.
_Avoid_: Script API key, domain whitelist

**Presence**:
Whether a visitor is still on the page, judged from how recently their credential made an authorized request. Distinct from **analytics presence**, which needs no credential.

**Analytics presence**:
The anonymous, credential-free signal the widget sends while the embedded page is visible, used only for counting (ticket 17). A browser counts as a **live visitor** while its latest beat is within the last two minutes, whatever the state of its chat. See ADR 0002 for the privacy bounds.

**Anonymous browser identifier**:
A random UUID the widget generates in its own storage on the chatbot origin — shared by that browser's tabs, never derived from anything a person typed or identified themselves with — rotating at least as often as the analytics retention period. Only its SHA-256 hash reaches the database.

**Reporting day**:
The calendar day an analytics event belongs to, drawn in the site's configured reporting time zone (default Asia/Singapore). Chat and escalation rollups, daily visitor counts, and period boundaries all use it.

**Analytics retention period**:
The owner-configured number of days analytics rows (anonymous presence and daily rollups) are kept before expiry removes them; separate from the retention period that governs transcripts. Always on, like transcript cleanup since its 30-day default (ticket 47): expiring visitor identifiers never waits on a configuration that may never come.

**Return link**:
A short-lived, single-use link that was mailed to a visitor so they could resume their own conversation after leaving. No longer issued (ticket 66): staff replies wait in the chat. Links mailed earlier stay redeemable until they expire; only the hash is stored, and redeeming one grants a fresh visitor session.

**Support hours**:
The staff desk's open days and times, expressed in the college's own time zone. Handoff wording reflects them; while unconfigured, visitors get a general follow-up message that promises no response time.

**Retention period**:
The number of days a closed conversation's transcript and visitor contact details (name, email, and phone number) are kept. Once the period passes, cleanup removes the conversation, its messages, and every way back into it. While no owner period is configured, a default of 30 days after closure applies (ticket 47); an explicit owner setting always wins, and the clock runs only from closure — active conversations are never removed for age.

**Retention run**:
The operator-visible record of one cleanup pass that removed expired conversations. It carries counts only — never message text or contact details.

**Delete (history)**:
A staff member's hard removal of ONE closed conversation from the History tab (ticket 51), behind a confirmation dialog. It uses the same transactional purge as the retention sweep; claimed or waiting conversations cannot be deleted.

**Clear history**:
An owner-only action that hard-removes every closed conversation from the History tab at once (ticket 51), behind a confirmation dialog stating how many will go. Conversations still claimed or waiting are kept. Distinct from the visitor's "Clear conversation", which starts the visitor a fresh chat.
