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
The queue of escalated conversations available to authorized staff until one person claims each conversation.

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
