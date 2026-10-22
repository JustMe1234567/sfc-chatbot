# 01: Approved answer in the WordPress widget

**What to build:** A visitor can open the site-wide chatbot script on a WordPress test page, ask a common question anonymously, and receive a seeded approved answer. The conversation remains available after a page reload. This first slice establishes the runnable application and its public API test seam.

**Blocked by:** None (can start immediately).

**Status:** resolved


- [x] The running app is Next.js App Router, with its visitor API implemented by Route Handlers and the standalone widget served as a public asset; no standalone Express server is needed.
- [x] A persistent local SQLite database stores the seeded answer rules, conversations, visitor session hashes, and messages through a versioned migration; the running app does not use the in-memory store.
- [x] The versioned widget script loads once on intended WordPress pages without changing WordPress core; it works on desktop and mobile.
- [x] A visitor can use the chat with keyboard controls and without signing in or providing an email address.
- [x] A seeded, published answer rule returns only its approved response and optional college page link; no AI API is called.
- [x] The visitor's question and bot answer persist and reappear after both a page reload and a Next.js process restart using only that visitor's session credential.
- [x] Public input limits apply. The page and widget expose no database, authentication, or email service secrets. The loader opens a cross-origin chatbot iframe; its expiring, conversation-scoped visitor credential stays in iframe-origin session storage, not WordPress `localStorage`. The public API and that visitor credential are treated as visible to that visitor.
- [x] Automated API and SQLite persistence flows plus an interactive browser check on the WordPress test page demonstrate the visitor journey on desktop and mobile, including a Next.js process restart.

## Comments

**2026-10-22 — implemented (Express + in-memory, superseded).** Express 5 + TypeScript app with the public API test seam. Superseded by the reopen below; the matcher, API behavior, widget assets, and tests were carried into the Next.js/SQLite re-implementation.

**2026-10-23 — reopened for the agreed stack.** The HTML page is only a WordPress embed fixture, but the committed runtime is Express with in-memory storage. The user has specified Next.js and Supabase for the whole application. Keep the reusable matcher, widget, API behavior, and tests where practical; move the running app to Next.js Route Handlers and Supabase persistence before starting ticket 02. Recheck all criteria after the migration, including an actual browser interaction instead of static presence checks alone.

**2026-10-23 — persistence and security change.** The user now wants SQLite during development and a later Supabase migration. Keep the Next.js requirement, use persistent local SQLite in this slice, and close the browser credential exposure and restart-persistence criteria before taking ticket 02. The earlier Supabase-first note above is superseded.

**2026-10-23 — re-implemented on Next.js + SQLite.**

What is in place:

- Next.js 16 App Router (`src/app/`); visitor API is Route Handlers (`/api/v1/conversations`, `/api/v1/conversations/[id]/messages`); no Express anywhere.
- SQLite via Node's built-in `node:sqlite` at `CHATBOT_DB` (default `chatbot.db`), schema applied by a versioned migration runner (`migrations/0001_initial_schema.sql`), behind the same `Store` port with portable SQL. In-memory store deleted; tests use temporary SQLite databases.
- Widget is now a loader (`public/widget/v1.js`) that renders only a launcher and a cross-origin iframe at `/widget/frame` (React chat page). The loader makes no API calls and touches no page storage. The visitor credential (opaque token, SHA-256-hashed server-side, 24 h server-enforced expiry) lives in iframe-origin `sessionStorage`.
- 23 automated tests green, typecheck clean: API flows, cross-visitor isolation, input limits, message/history/creation rate limits, session expiry, embed smoke (loader free of storage/API usage), and a restart test that spawns `next dev` twice and reads the conversation after the restart.

Interactive browser check (in-app browser, cross-origin fixture at `tests/fixtures/cross-origin-page.html` served from a second origin):

- Desktop 1280×800: opened chat from the launcher, asked the admissions question, received the seeded approved answer with the college link.
- WordPress-origin `localStorage` and `sessionStorage` verified empty after chatting — credential confined to the chatbot origin.
- Page reload → history restored; Next.js process killed and restarted → history still restored after reload.
- Mobile 390×844: asked the fees question in the same conversation; layout verified near-full-screen after fixing an iframe sizing bug the check caught (replaced-element `width:auto` collapses to the 300 px default). Two other fixes from this check: `allowedDevOrigins` for the loopback host in `next.config.ts`, and the loader bundle rebuilt.

Judgment calls left for the human pass:

- "Short-lived" visitor credential is implemented as a 24-hour server-enforced expiry (plus `sessionStorage`, which dies with the tab). Tighten if the college prefers.
- The per-IP creation limiter keys on `x-forwarded-for` (spoofable when clients talk to the app directly). In dev all local visitors share one 100/min bucket. The production fronting platform overwrites this header; revisit at the ticket 11 deploy.
- The restart persistence test runs `next dev`, not a `next build` + `next start` production boot (a production-build variant would roughly double suite time for the same persistence proof). `next start` behavior can be covered by the ticket 11 preview checks.
- The root route (`/`) is a minimal landing page linking the demo, `noindex` via robots metadata — unrequested but the App Router needs a root page and it keeps crawlers off the internal app.
- `ORDER BY created_at, rowid` in the SQLite store needs a Postgres-native monotonic tie-break when ticket 11 lands.

**2026-10-23 — accepted as complete.** The human pass accepted the implementation and its recorded judgment calls as they stand (24 h visitor credential expiry, dev-keyed rate limiter, `next dev` restart test, root landing page). The Postgres ordering tie-break and the production `x-forwarded-for` handling remain parked on ticket 11. Status set to `resolved`; ticket 02 is unblocked.
