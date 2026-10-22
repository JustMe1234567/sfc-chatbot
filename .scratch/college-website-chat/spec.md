# College website chatbot and live staff takeover

Status: ready-for-agent

## Problem Statement

Public visitors need quick answers to routine questions about the college. The college also needs to receive questions that its approved content cannot answer and continue those conversations with a person. The WordPress website has no current chatbot implementation in this repository.

## Solution

Add an English-language chat widget to the college WordPress site. It offers common-topic buttons and accepts typed questions. The bot responds only from staff-curated answer rules; it does not call an AI API or automatically turn arbitrary WordPress pages into answers. An unknown question or configured escalation phrase immediately creates an escalation, pauses bot replies, alerts staff once by email, and puts the conversation in a shared inbox. A named staff member can claim it and reply to the visitor in the same chat.

Visitors can begin anonymously. At handoff, they may supply an email address to receive a secure return link if they leave. Live chat remains available to visitors who decline email while their chat session is active. The dashboard also lets authorized staff manage answers, escalation phrases, support hours, staff access, and transcript retention.

## User Stories

1. As a visitor, I want to open a chat widget on the college site, so that I can ask a question without leaving the page.
2. As a mobile visitor, I want the widget to fit my screen and remain usable with touch, so that I can chat on my phone.
3. As a keyboard or screen-reader user, I want the chat controls and new messages to be accessible, so that I can use the service independently.
4. As a visitor, I want to start without an account or email address, so that a routine question has little friction.
5. As a visitor, I want to see common topics, so that I can find an approved answer without guessing how to phrase a question.
6. As a visitor, I want to type a question in my own words, so that I can ask beyond the visible topic buttons.
7. As a visitor, I want a relevant approved answer and an optional link to its college page, so that I can trust and explore the information.
8. As a visitor, I want the bot to offer choices when several answer rules match, so that it does not select the wrong answer for me.
9. As a visitor, I want an unknown question sent to staff immediately, so that I can get help when the bot has no approved answer.
10. As a visitor, I want a configured handoff phrase to reach staff even if another answer rule matches, so that I can request a person directly.
11. As a visitor, I want to know when the bot has handed my conversation to staff, so that I do not wait for another automated answer.
12. As a visitor, I want to see support hours or a general follow-up message, so that I know what response to expect without a false promise.
13. As a visitor, I want to give my email address at handoff, so that staff can notify me if I leave the page.
14. As a visitor, I want to decline email and remain in the live chat, so that providing contact details is optional.
15. As a visitor who declines email, I want a clear warning that staff cannot follow up after I leave, so that I understand the consequence.
16. As a visitor who leaves after providing email, I want a secure return link when staff replies, so that I can resume the same conversation.
17. As a visitor, I want to see the conversation history after a page reload or valid return, so that I can follow what has already been said.
18. As a staff member, I want to sign in with my own account, so that access to visitor conversations is attributable and controlled.
19. As an owner, I want to invite and disable staff accounts, so that only current authorized staff can access the inbox.
20. As a staff member, I want a shared inbox of unclaimed escalations, so that the next available person can respond.
21. As a staff member, I want to claim a conversation, so that another staff member does not send a conflicting reply.
22. As a staff member, I want to read the bot and visitor messages before replying, so that I have the full context.
23. As a staff member, I want my reply to appear promptly in the visitor's widget, so that the handoff feels like live chat.
24. As a staff member, I want to release or transfer a claimed conversation, so that another person can take it when needed.
25. As a staff member, I want to close a resolved conversation, so that the inbox reflects outstanding work.
26. As a staff member, I want failed email alerts to be visible and retryable, so that an escalation is not silently lost.
27. As a content editor, I want to create, revise, preview, and publish answer rules and topic buttons, so that the bot uses only approved information.
28. As a content editor, I want to manage synonyms and escalation phrases, so that known wording routes predictably.
29. As a content editor, I want to see when an answer was last reviewed, so that outdated college information can be corrected.
30. As an owner, I want to configure support hours and the email alert destination, so that the handoff fits the college's staffing process.
31. As an owner, I want to configure transcript retention, so that conversations do not remain indefinitely by default.
32. As a site owner, I want to load the widget through one site-wide script, so that the chatbot appears consistently without changing WordPress core.
33. As a site owner, I want chatbot credentials kept outside the public WordPress page, so that visitors cannot obtain staff or service secrets.
34. As a college reviewer, I want to know which external services receive messages and email addresses, so that I can approve the deployment before launch.

## Implementation Decisions

- The visitor widget is delivered as a versioned script hosted with the chatbot. WordPress loads it once site-wide through its script enqueue mechanism or an existing site-wide embed facility. A custom WordPress plugin is optional only if the site has no reliable site-wide script placement or later needs WordPress-specific settings. WordPress does not implement the conversation backend or expose service secrets in page output.
- The chatbot dashboard and HTTP API run on Vercel. A managed Postgres database stores answer rules, conversations, messages, escalation state, staff assignments, settings, and notification records. Supabase is the proposed database, authentication, and private realtime provider; the college's review must approve the final services before production deployment.
- An approved transactional email sender delivers staff alerts and secure visitor return links. Email is a notification channel; staff compose replies in the dashboard, and the visitor reads them in the widget. Email bodies do not contain full transcripts.
- Answer rules are maintained in the chatbot dashboard. Each published rule contains a topic, approved response, phrase aliases or keyword conditions, and an optional college page link. Draft rules do not answer visitors. The first release does not scrape or automatically synchronize WordPress pages.
- Matching is deterministic. Normalize case, whitespace, and punctuation; evaluate configured phrases and keyword conditions with word boundaries; and reject empty or invalid input. Explicit escalation phrases take precedence over answer rules. One answer match returns its approved response; several plausible matches show choices; no match escalates. The matcher does not invent a response or use an AI API.
- Conversation states include bot active, awaiting staff, claimed, and closed. Escalation pauses bot replies. Claiming is atomic so only one staff member owns a conversation at a time. Authorized staff can release or transfer a claim. New questions after closure start a new conversation.
- Each conversation has an opaque visitor session credential. A visitor can reload and resume while that credential remains valid. Staff accounts have distinct identities and role-based access. Visitor credentials cannot read other conversations or staff-only data.
- Email is requested only at escalation. It is optional for live chat. A visitor who supplies it can receive a short-lived, single-use or otherwise revocable return link when staff replies after departure. Staff do not receive a fresh email for every message; the escalation alert is deduplicated per conversation.
- The shared inbox updates through private realtime channels, with the database as the source of truth. Clients reconnect and reload missed messages after a dropped connection. Visitor and staff subscriptions are restricted to conversations they may access.
- Support hours, alert recipients, escalation phrases, and retention length are configurable. Until hours are configured, the widget gives only a general follow-up message. A retention job deletes expired transcripts and associated visitor contact details according to the configured period.
- Public endpoints enforce input limits and abuse controls. All rendered message text is treated as untrusted. Administrative actions require authorization, and the system records staff claims, transfers, replies, and content publishing for accountability.
- The initial content is English and addresses public topics such as admissions, courses, fees, and campus information. Student-specific account and personal-record questions are outside this release and should route to an appropriate human channel.

## Testing Decisions

- The primary automated seam is the public and staff HTTP API with a controlled test store. Tests assert externally visible conversation results and persisted state rather than implementation details of the matcher or UI components.
- Complete API flows cover one approved answer, several matches and topic choices, an unknown question, an escalation phrase overriding an answer, alert deduplication, optional visitor email, staff claim contention, staff reply, visitor return, and closure.
- Authorization tests prove that a visitor cannot read another conversation, an unassigned staff account cannot perform an unauthorized action, and a disabled staff account loses access. Abuse tests cover oversized input and repeated requests.
- Browser checks cover the WordPress widget on desktop and mobile, keyboard and screen-reader behavior, the staff inbox, and a reply reaching the visitor after a connection drop and reload.
- This repository has no existing application tests to follow. The first implementation slice should establish the API flow harness and a smoke check that the script loads once on the intended WordPress pages.

## Out of Scope

- AI-generated answers, embeddings, semantic search, or calls to an AI API.
- Automatic scraping or synchronization of WordPress pages into answer rules.
- Student account lookup, personalized records, admissions application processing, or collection of sensitive documents.
- Languages beyond English in the first release.
- Attachments, voice, SMS, social messaging channels, and email-based staff replies.
- A full helpdesk analytics or ticketing platform.

## Further Notes

- Production launch requires college IT or site owner review of Vercel, the database and realtime provider, the email sender, data access, and transcript retention.
- The college must provide initial approved answer content, escalation phrases, support hours, alert recipients, the retention period, and the WordPress site where the widget will appear. These are launch configuration values, not open architecture decisions.
- The first implementation should prove one visitor question, one escalation, one email alert, one staff claim, and one staff reply through the WordPress widget and dashboard before expanding the answer library.
- Platform references: [WordPress script loading](https://developer.wordpress.org/reference/functions/wp_enqueue_script/), [Supabase private realtime subscriptions](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes), [Vercel storage integrations](https://vercel.com/docs/marketplace-storage), and [Vercel WebSocket behavior](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections).
