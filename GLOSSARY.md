# College Website Chat

Terms used for visitor questions and staff handoff on the college website.

## Language

**Visitor**:
A member of the public using the college website chat. The first release does not handle student account questions.

**Answer rule**:
An approved question pattern and its associated response about the college, maintained by staff. A visitor question is unknown when no answer rule applies.

**Escalation**:
A request for staff help raised immediately when a question is unknown or matches a configured handoff phrase. Bot replies pause while the request is open.

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

**Clear conversation**:
The visitor's action to end the current chat and start a fresh one. Staff keep the old transcript in History under the retention policy; the visitor's credential and any unused return link are revoked immediately.

**Conversation**:
The message history shared by a visitor, the bot, and any administrator who takes over.

**Staff account**:
The named identity of a college employee who can sign in to the private dashboard. Its permissions depend on the employee's assigned role.

**Visitor session**:
The temporary identity that lets one public visitor resume and read their own conversation without creating a staff account.

**Presence**:
Whether a visitor is still on the page, judged from how recently their credential made an authorized request. A staff reply to a departed visitor emails the return link; a reply to a present visitor does not.

**Return link**:
A short-lived, single-use link mailed to a visitor so they can resume their own conversation after leaving. Only its hash is stored; redeeming it grants a fresh visitor session.

**Support hours**:
The staff desk's open days and times, expressed in the college's own time zone. Handoff wording reflects them; while unconfigured, visitors get a general follow-up message that promises no response time.

**Retention period**:
The owner-configured number of days a closed conversation's transcript and visitor contact details are kept. Once the period passes, cleanup removes the conversation, its messages, and every way back into it; while unconfigured, closed transcripts are kept indefinitely.

**Retention run**:
The operator-visible record of one cleanup pass that removed expired conversations. It carries counts only — never message text or contact details.
