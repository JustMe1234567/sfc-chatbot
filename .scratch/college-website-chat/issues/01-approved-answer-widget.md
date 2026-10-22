# 01: Approved answer in the WordPress widget

**What to build:** A visitor can open the site-wide chatbot script on a WordPress test page, ask a common question anonymously, and receive a seeded approved answer. The conversation remains available after a page reload. This first slice establishes the runnable application and its public API test seam.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent


- [ ] The running app is Next.js App Router, with its visitor API implemented by Route Handlers and the standalone widget served as a public asset; no standalone Express server is needed.
- [ ] Supabase Postgres stores the seeded answer rules, conversations, visitor session hashes, and messages through a versioned migration; the running app does not use the in-memory store.
- [ ] The versioned widget script loads once on intended WordPress pages without changing WordPress core; it works on desktop and mobile.
- [ ] A visitor can use the chat with keyboard controls and without signing in or providing an email address.
- [ ] A seeded, published answer rule returns only its approved response and optional college page link; no AI API is called.
- [ ] The visitor's question and bot answer persist and reappear after both a page reload and a Next.js process restart using only that visitor's session credential.
- [ ] Public input limits apply, and neither the page nor the widget exposes server-side service secrets.
- [ ] Automated API and Supabase persistence flows plus an interactive browser check on the WordPress test page demonstrate the visitor journey on desktop and mobile.

## Comments

**2026-10-22 — implemented.** Express 5 + TypeScript app (`src/`), in-memory `Store` port (Postgres implementation deferred to the dashboard tickets), deterministic matcher (normalized, word-boundary, drafts never answer, several matches never guess), opaque SHA-256-hashed visitor session tokens, per-conversation message/history limits plus per-IP creation limit, widget bundled to a self-contained `public/widget/v1.js`, WordPress test page under `public/demo/`, optional enqueue plugin under `wordpress/`. Tests: 19 (API flow + embed smoke), typecheck clean. Run with `npm run dev`; see `README.md`.

Review notes for the human pass:

- Desktop/mobile and keyboard criteria are verified by static presence checks in the smoke test (responsive media query, ARIA roles, Escape handling). Interactive browser verification is the spec's browser-check slice and is not yet scheduled to a ticket.
- The spec makes a site-wide script the default and a WordPress plugin optional; the committed `wordpress/sfc-chatbot.php` is a 36-line mu-plugin that only enqueues the script. Drop it if the college prefers theme-level enqueue — nothing else depends on it beyond one smoke assertion.
- No-match questions get an honest "no approved answer" bot reply for now; ticket 02 replaces it with the escalation flow.

**2026-10-23 — reopened for the agreed stack.** The HTML page is only a WordPress embed fixture, but the committed runtime is Express with in-memory storage. The user has specified Next.js and Supabase for the whole application. Keep the reusable matcher, widget, API behavior, and tests where practical; move the running app to Next.js Route Handlers and Supabase persistence before starting ticket 02. Recheck all criteria after the migration, including an actual browser interaction instead of static presence checks alone.
