# College website chatbot

English-language chat widget for the college WordPress site. Visitors ask
questions and get answers only from staff-curated answer rules; unknown
questions escalate to staff (later tickets). No AI API is called.

The approved spec and delivery tickets live in `.scratch/college-website-chat/`.

## Run locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000/demo/wordpress-test-page.html> and use the chat.
The server seeds two published answer rules (admissions, fees) and one draft
rule (scholarships) from `src/store/seed.ts`.

## Test and typecheck

```bash
npm test          # API flow tests + WordPress embed smoke check
npm run typecheck
npm run build:widget   # rebuild public/widget/v1.js after editing the widget
```

The automated test seam is the public HTTP API with a controlled in-memory
store (`tests/api-answer-flow.test.ts`), per the spec's testing decisions.

## Layout

| Path | Purpose |
| --- | --- |
| `src/domain/` | Pure matching, limits, tokens, and entity types |
| `src/server/` | Express app and entrypoint (`npm run dev`) |
| `src/store/` | Store port, in-memory implementation, seed content |
| `src/widget/` | Visitor widget source, bundled to `public/widget/v1.js` |
| `public/demo/` | WordPress-style test page for the embed |
| `wordpress/` | Optional mu-plugin that enqueues the widget site-wide |

Storage currently runs in memory (conversations survive page reloads while the
server runs); a Postgres-backed `Store` implementation lands with the
dashboard tickets. The production launch gate (college approval of external
services) is documented in the spec.

## WordPress integration

One script tag, site-wide, via `wp_enqueue_script` — see `wordpress/README.md`.
The widget derives its API base URL from its own `src`, so no service
credentials appear in the page.
