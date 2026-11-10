# College website chatbot and live staff takeover

Status: ready-for-agent

## Problem Statement

Public visitors need quick answers to routine questions about the college. The college also needs to receive questions that its approved content cannot answer and continue those conversations with a person. The WordPress website has no current chatbot implementation in this repository.

## Solution

Add an English-language chat widget to the college WordPress site. It offers common-topic buttons and accepts typed questions. The bot responds only from staff-curated answer rules; it does not call an AI API or automatically turn arbitrary WordPress pages into answers. An unknown question offers a visitor the choice to chat with a human; accepting that offer, or using a configured escalation phrase, creates an escalation, pauses bot replies, alerts staff once by email, and puts the conversation in a shared inbox. A named staff member can claim it and reply to the visitor in the same chat.

Every new chat begins with a brief contact form: the visitor's full name, email address, and phone number are required before topic buttons, typed questions, bot answers, or human handoff can be used, and the server enforces the requirement on every submission. A visitor whose chat is still valid resumes without re-entering their details; starting another chat asks again. The dashboard labels conversations with the visitor's name beside their state and lets authorized staff manage answers, escalation phrases, support hours, staff access, and transcript retention. Staff replies wait in the visitor's open chat; visitor return-link emails are no longer sent, though links issued before that change stay redeemable until their normal expiry.

## User Stories

1. As a visitor, I want to open a chat widget on the college site, so that I can ask a question without leaving the page.
2. As a mobile visitor, I want the widget to fit my screen and remain usable with touch, so that I can chat on my phone.
3. As a keyboard or screen-reader user, I want the chat controls and new messages to be accessible, so that I can use the service independently.
4. As a visitor, I want to start a chat by sharing my full name, email address, and phone number in one brief form — no account — so that the college knows who it is helping before I ask anything.
5. As a visitor, I want to see common topics, so that I can find an approved answer without guessing how to phrase a question.
6. As a visitor, I want to type a question in my own words, so that I can ask beyond the visible topic buttons.
7. As a visitor, I want a relevant approved answer and an optional link to its college page, so that I can trust and explore the information.
8. As a visitor, I want the bot to offer choices when several answer rules match, so that it does not select the wrong answer for me.
9. As a visitor, I want an unknown question to offer human help before contacting staff, so that I control whether the conversation is escalated.
10. As a visitor, I want a configured handoff phrase to reach staff even if another answer rule matches, so that I can request a person directly.
11. As a visitor, I want to know when the bot has handed my conversation to staff, so that I do not wait for another automated answer.
12. As a visitor, I want to see support hours or a general follow-up message, so that I know what response to expect without a false promise.
13. As a visitor, I want a failed contact submission to keep what I typed and say clearly what to fix, so that I can retry without starting over.
14. As a returning visitor, I want my still-valid chat to resume without asking for my details again, so that a page reload does not interrupt me.
15. As a visitor, I want every newly started chat — including one after I clear the chat, or after it closes or lapses — to ask for my details again, so that each conversation carries accurate contact information.
16. As a visitor, I want staff replies to appear in my open chat rather than arriving through emailed links, so that the conversation stays in one place.
17. As a visitor, I want to see the conversation history after a page reload or valid return, so that I can follow what has already been said.
18. As a staff member, I want to sign in with my own verified account and a second factor, so that access to visitor conversations is attributable and controlled.
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
35. As a staff member, I want to reset a forgotten password and sign out of all sessions, so that I can recover access and respond to a suspected account compromise.
36. As an owner, I want staff registration to be invite-only, so that a public visitor cannot create a staff account.
37. As a site owner, I want the chatbot to keep database, authentication, and email service secrets on the server, so that inspecting the widget or dashboard cannot reveal them.
38. As a staff member, I want each conversation labeled with the visitor's name beside its state, so that I can tell conversations apart at a glance.

## Implementation Decisions

- The visitor widget is delivered as a versioned loader script hosted with the chatbot. WordPress loads it once site-wide through its script enqueue mechanism or an existing site-wide embed facility. The loader opens a cross-origin chatbot iframe so the visitor session credential stays under the chatbot origin rather than in WordPress page storage. A custom WordPress plugin is optional only if the site has no reliable site-wide script placement or later needs WordPress-specific settings. WordPress does not implement the conversation backend or expose service secrets in page output.
- A Next.js App Router application runs the chatbot dashboard and HTTP API. Its public assets include the standalone widget loader that WordPress embeds. The current development runtime uses a persistent local SQLite file for answer rules, conversations, messages, visitor sessions, and staff authentication. Schema changes use versioned migrations. An in-memory store may be used in isolated tests but not as the running app's store. Keep persistence behind a server-side interface and use portable SQL where practical so the data can later migrate to Supabase Postgres.
- Staff authentication is part of the first protected inbox slice. Use a maintained authentication library with SQLite and Postgres support, preferably Better Auth, rather than custom password or session code. Staff accounts are named and invite-only, with verified email, password login, required TOTP-based multifactor authentication, expiring single-use password reset, explicit logout and session revocation, and owner/staff/editor roles. The owner is bootstrapped by a server-side setup procedure, never by public sign-up. Keep the same authentication system when moving its store to Supabase Postgres; Supabase Auth is not a first-release dependency.
- Dashboard pages and every staff API action check the current server-side session, active-account state, and role; a client-side route guard alone is insufficient. Use Secure, HttpOnly, SameSite cookies for staff sessions in production, server-enforced expiry and revocation, CSRF protection for state-changing cookie-authenticated requests, login/reset rate limits, and generic login errors. Disablement and password reset revoke existing sessions. Audit security-sensitive staff actions. Enforce HTTPS in production.
- The iframe must call a public chat HTTP endpoint, so its URL and request contract are visible in browser developer tools. The iframe may hold only a short-lived, conversation-scoped visitor credential; it never receives a staff credential, database connection string, authentication secret, or email API key. Put secrets in uncommitted local `.env` files and production server environment settings, without a `NEXT_PUBLIC_` prefix or client-exposed Next configuration. Do not send secrets in rendered HTML, client bundles, public source maps, or API responses. Restrict any cross-origin API access to approved origins, and enforce authorization and abuse limits on the server; CORS is not an access-control substitute. Replace the existing visitor token in WordPress `localStorage` with iframe-origin session storage and expiry; verify reload behavior on the target browsers.
- A writable SQLite file is for local development or a stateful self-hosted preview. Vercel's function filesystem is ephemeral, so production deployment on Vercel waits for the separate Supabase Postgres migration. That migration must move existing data and staff accounts safely, revoke old staff sessions for reauthentication, verify the full chat flow, and pass college IT/site-owner review before launch.
- An approved transactional email sender delivers staff alerts. Visitor return-link emails are no longer sent (links issued before that change stay redeemable until their normal expiry). Email is a notification channel; staff compose replies in the dashboard, and the visitor reads them in the widget. Email bodies do not contain full transcripts.
- Answer rules are maintained in the chatbot dashboard. Each published rule contains a topic, approved response, phrase aliases or keyword conditions, and an optional college page link. Draft rules do not answer visitors. The first release does not scrape or automatically synchronize WordPress pages.
- Matching is deterministic. Normalize case, whitespace, and punctuation; evaluate configured phrases and keyword conditions with word boundaries; and reject empty or invalid input. Explicit escalation phrases take precedence over answer rules. One answer match returns its approved response; several plausible matches show choices; no match offers a visitor-consented human handoff. The matcher does not invent a response or use an AI API.
- Conversation states include bot active, awaiting staff, claimed, and closed. Escalation pauses bot replies. Claiming is atomic so only one staff member owns a conversation at a time. Authorized staff can release or transfer a claim. New questions after closure start a new conversation.
- Each conversation has an opaque visitor session credential. A visitor can reload and resume while that credential remains valid. Staff accounts have distinct identities and role-based access. Visitor credentials cannot read other conversations or staff-only data.
- Every new conversation requires the visitor's full name, email address, and phone number (ticket 66), validated and stored with the conversation. The server rejects visitor messages and topic choices on any conversation without accepted details — including direct API requests and sessions from before the requirement — so hiding controls alone cannot bypass the gate. A still-valid conversation resumes without re-entry; every newly started one, including after Clear chat, closure, or a lapse, asks again. The phone number is collected and retained only; any phone-specific display or follow-up belongs to a separate change. Staff do not receive a fresh email for every message; the escalation alert is deduplicated per conversation.
- The shared inbox and visitor widget refresh through authorized polling while SQLite is the store, with the database as the source of truth. Clients reload missed messages after a dropped connection. After the Supabase migration, a private realtime transport may replace polling only if subscription authorization is verified for each conversation.
- Support hours, alert recipients, escalation phrases, and retention length are configurable. Until hours are configured, the widget gives only a general follow-up message. A retention job deletes expired transcripts and associated visitor contact details according to the configured period.
- Public endpoints enforce input limits and abuse controls. All rendered message text is treated as untrusted. Administrative actions require authorization, and the system records staff claims, transfers, replies, and content publishing for accountability.
- The initial content is English and addresses public topics such as admissions, courses, fees, and campus information. Student-specific account and personal-record questions are outside this release and should route to an appropriate human channel.

## Testing Decisions

- The primary automated seam is the Next.js public and staff HTTP API with a controlled SQLite test database. Tests assert externally visible conversation results and persisted state rather than implementation details of the matcher or UI components. A database integration check proves that a visitor conversation survives a Next.js process restart. The later Supabase migration reruns the same complete flows against Postgres.
- Complete API flows cover one approved answer, several matches and topic choices, an unknown question, an escalation phrase overriding an answer, alert deduplication, the required visitor contact gate (rejected submissions, direct API bypass attempts against legacy conversations, and successful starts), staff claim contention, staff reply, redemption of previously issued return links, and closure.
- Authentication and authorization tests prove that public staff sign-up is closed; unverified or second-factor-incomplete staff cannot enter the dashboard; wrong credentials, expired or revoked sessions, and reset-token replay fail; a visitor cannot read another conversation; an unassigned staff account cannot perform an unauthorized action; and a disabled staff account loses access immediately. Abuse tests cover oversized input and repeated requests.
- Browser checks cover the WordPress widget on desktop and mobile, keyboard and screen-reader behavior, the staff inbox, and a reply reaching the visitor after a connection drop and reload.
- The first implementation slice establishes the Next.js API flow harness, a SQLite migration and restart-persistence check, a visitor credential exposure review, and a smoke check that the script loads once on the intended WordPress pages. The protected inbox slice establishes staff login and multifactor authentication before staff can see transcripts.

## Out of Scope

- AI-generated answers, embeddings, semantic search, or calls to an AI API.
- Automatic scraping or synchronization of WordPress pages into answer rules.
- Student account lookup, personalized records, admissions application processing, or collection of sensitive documents.
- Languages beyond English in the first release.
- Attachments, voice, SMS, social messaging channels, and email-based staff replies.
- A full helpdesk analytics or ticketing platform.

## Further Notes

- Production launch requires the Supabase Postgres migration and college IT or site owner review of Vercel, Supabase, the email sender, authentication controls, data access, and transcript retention. Local SQLite is not a Vercel production database.
- The college must provide initial approved answer content, escalation phrases, support hours, alert recipients, the retention period, and the WordPress site where the widget will appear. These are launch configuration values, not open architecture decisions.
- The first implementation should prove one visitor question, one escalation, one email alert, one staff claim, and one staff reply through the WordPress widget and dashboard before expanding the answer library.
- Platform references: [WordPress script loading](https://developer.wordpress.org/reference/functions/wp_enqueue_script/), [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers), [Next.js server environment variables](https://nextjs.org/docs/app/guides/environment-variables), [Better Auth SQLite and Postgres adapters](https://better-auth.com/docs/installation), [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [Vercel SQLite limitation](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel), and [Supabase local development and migrations](https://supabase.com/docs/guides/local-development/cli/getting-started).
