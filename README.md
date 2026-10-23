# College website chatbot

English-language chat widget for the college WordPress site. Visitors ask
questions and get answers only from staff-curated answer rules; unknown
questions escalate to staff (later tickets). No AI API is called.

The approved spec and delivery tickets live in `.scratch/college-website-chat/`.
The stack decision (Next.js App Router, SQLite during development, Supabase
Postgres migration before Vercel production) is recorded in
`docs/adr/0001-sqlite-first-with-server-owned-auth.md`.

## Run locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000/demo/wordpress-test-page.html> and use the chat.
The app seeds two published answer rules (admissions, fees) and one draft rule
(scholarships) from `src/store/seed.ts` into SQLite at `CHATBOT_DB`
(default `chatbot.db`, gitignored).

To exercise the embed exactly as a college site would — a different origin —
serve `tests/fixtures/cross-origin-page.html` from another port (it points at
`http://127.0.0.1:3000/widget/v1.js`).

## Test and typecheck

```bash
npm test              # API flows, embed smoke, restart persistence, abuse limits
npm run typecheck
npm run build:widget  # rebuild public/widget/v1.js after editing the loader
```

Tests run the Next.js route handlers directly against a temporary SQLite
database (the spec's controlled-test-store seam). The restart test spawns
`next dev` twice and proves the conversation survives the process restart.

## How the widget is embedded

- `public/widget/v1.js` (built from `src/widget/loader.ts`) is the only thing
  WordPress loads. It renders a launcher button and a cross-origin iframe at
  `/widget/frame`; it makes no API calls and never touches page storage.
- The visitor session credential lives in chatbot-origin `sessionStorage`
  inside the iframe — never in WordPress `localStorage` — and expires
  server-side after 24 hours.
- The chat UI inside the iframe is the React page at
  `src/app/widget/frame/page.tsx`, which calls the public API same-origin.

## Staff dashboard and authentication

Staff access is invite-only and second-factor protected:

```bash
npm run bootstrap:owner -- --email owner@example.edu --password 'a-long-password' --name 'Owner'
npm run dev
```

Open <http://localhost:3000/dashboard>. The first sign-in forces TOTP
enrollment (an authenticator app secret is displayed), then signs out; every
later sign-in requires password plus the current code. Passwords, sessions,
and staff records live in SQLite through Better Auth (`migrations/0002`);
verification and reset emails land in the `mail_outbox` table in development.

Environment settings: `CHATBOT_DB` (database file), `CHATBOT_BASE_URL`
(public origin), `BETTER_AUTH_SECRET` (required outside local development).
Secrets never reach client bundles: no `NEXT_PUBLIC_` variable carries them.

## Layout

| Path | Purpose |
| --- | --- |
| `src/app/` | Next.js App Router: pages, the widget frame, and API route handlers |
| `src/api/` | Request-side helpers shared by route handlers (visitor + staff auth guards) |
| `src/auth/` | Better Auth configuration and server-side staff provisioning |
| `src/lib/` | Shared client helpers (auth client, visitor session storage) |
| `src/domain/` | Pure matching, limits, tokens, hours, retention sweep, entity types, and answer-rule input validation |
| `src/store/` | SQLite store behind the `Store` port, and seed content |
| `src/db/` | SQLite connection, versioned migration runner, service singleton |
| `src/widget/` | Loader script bundled to `public/widget/v1.js` |
| `src/mail/` | Development mail transport (mail_outbox table) |
| `migrations/` | Versioned SQL schema migrations |
| `public/demo/` | WordPress-style test page for the embed |
| `wordpress/` | Optional mu-plugin that enqueues the loader site-wide |

SQLite is for development and stateful self-hosted preview only; Vercel's
filesystem is ephemeral. Production deployment waits for the Supabase Postgres
migration (ticket 11), which is also a college-review launch gate documented in
the spec.
