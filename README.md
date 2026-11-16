# College website chatbot

English-language chat widget for the college WordPress site. Visitors ask
questions and get answers only from staff-curated answer rules; unknown
questions escalate to staff (later tickets). No AI API is called.

The approved spec and delivery tickets live in `.scratch/college-website-chat/`.
The current stack decision (Next.js App Router, Supabase Postgres, and
Supabase Auth for staff) is recorded in ADRs 0003 and 0004.

## Run locally

```bash
npm install
npm run config:import # once, against a fresh test project (see the runbook)
npm run dev
```

Open <http://localhost:3000/demo/wordpress-test-page.html> and use the chat.
Localhost uses the dedicated hosted Supabase test project for both Postgres
and staff Auth. Configure `.env.local` from
[`.env.example`](.env.example); production configuration lives in
[docs/deployment.md](docs/deployment.md).

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
npm run bootstrap:owner -- --email owner@example.edu --name 'Owner'
npm run dev
```

Open <http://localhost:3000/dashboard>. The owner follows the emailed invite,
creates a password, and enrolls TOTP. Supabase Auth owns credentials and
sessions; `staff_members` owns application roles and disablement. Only the
project URL and publishable key are public. The secret key and database URL
remain server-only.

## Production database (Postgres)

`DATABASE_URL` names the same Supabase project as the Auth URL. The Postgres
schema is applied automatically. `docs/deployment.md` covers project setup,
configuration-only transfer, owner invitation, recovery, and test deployment.

Run the full test suite against Postgres:

```bash
CHATBOT_TEST_POSTGRES_URL="postgres://user:pass@host:5432/postgres" npm test
```

Scheduled maintenance (transcript retention + analytics expiry) runs through
`GET /api/maintenance`, triggered daily by Vercel cron (`vercel.json`) with
`CRON_SECRET`, or by ordinary staff dashboard traffic.

## Layout

| Path | Purpose |
| --- | --- |
| `src/app/` | Next.js App Router: pages, the widget frame, and API route handlers |
| `src/api/` | Request-side helpers shared by route handlers (visitor + staff auth guards) |
| `src/auth/` | Supabase Auth provider boundary and server-side staff provisioning |
| `src/lib/` | Shared client helpers (auth client, visitor session storage) |
| `src/domain/` | Pure matching, limits, tokens, hours, activity, retention sweep, entity types, and answer-rule input validation |
| `src/store/` | SQLite and Postgres stores behind the `Store` port, shared row mappers, and seed content |
| `src/db/` | Backend connections (SQLite + Postgres), portable query surface, versioned migration runners, service singleton |
| `src/widget/` | Loader script bundled to `public/widget/v1.js` |
| `src/mail/` | Development mail transport (mail_outbox table) |
| `migrations/` | Versioned SQL schema migrations (SQLite and `postgres/`) |
| `public/demo/` | WordPress-style test page for the embed |
| `wordpress/` | Optional mu-plugin that enqueues the loader site-wide |

SQLite remains an isolated application-test backend; localhost and Vercel use
Supabase Postgres (see `docs/deployment.md`).
