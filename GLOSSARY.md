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
Whether a conversation is still live on the desk, judged from its latest meaningful message — a visitor or staff message; polling, presence, and page views do not count. A conversation leaves the active lists exactly 24 hours after its latest meaningful message and waits in History, transcript kept.

**Attention**:
The in-dashboard signal that a conversation has something new for staff — a fresh escalation or a visitor message while staff help is active. Viewing, replying, or claiming clears it; it never duplicates while standing.

**Status treatment**:
The conversation desk's three-tier coloring (ticket 44, re-colored in ticket 66): Needs human (an escalation waiting for a claim, green) outranks New message (standing attention, red) outranks Active (a live bot or claimed chat with nothing unread, yellow). Every tier pairs its color with visible text or a dot carrying an accessible name, applied consistently to list rows, badges, counts, and the selected conversation's header. History rows are the archive and carry no treatment.

**Notification sound**:
The desk's alert (tickets 44, 77): a buzzer-like alert — one-second buzzes on and off across a 6-second window — when a conversation needs staff. While any live desk conversation sits in Needs human, the alert repeats every 30 seconds — measured from the start of one alert to the start of the next — and stops the moment the state clears or sounds are muted; unmuting with a conversation still waiting restarts the cycle. Ordinary new-message attention keeps 44's behavior: one soft chime cue per attention episode per staff browser, anchored at the instant the episode began. Muting is per-browser and never hides the visual indicators; audio blocked before the first interaction plays one late cue instead of a backlog.

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
The message history shared by a visitor, the bot, and any administrator who takes over.

**Staff account**:
The named dashboard membership of a college employee. An owner assigns its username, initial password, and owner/staff/editor role; dashboard access begins only after the employee enrolls an authenticator.

**Owner**:
The highest-privilege staff role, responsible for security-sensitive dashboard configuration and staff administration.
_Avoid_: Superadmin, administrator

**Staff credential reset**:
An owner-issued password or authenticator reset for an existing staff account. Password resets revoke every session but preserve the authenticator; authenticator resets revoke every session and require enrollment of a new factor.

**Authenticator recovery**:
The controlled process for a staff member who has lost their authenticator. An owner or trusted operator verifies the person, revokes their sessions and old factor, then requires enrollment of a new authenticator before dashboard access resumes.

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
