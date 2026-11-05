# 59: Reduce idle widget history requests without delaying open-chat replies

**Status:** ready-for-human

**Priority:** Cost and request-volume optimization

**What to build:** The widget currently fetches the full authorized conversation history every 3 seconds whenever it has a saved visitor session, including while the chat panel is closed. Reduce those idle requests while keeping near-live replies in an open chat and preserving visitor-presence behavior used by return emails.

- [x] Keep the existing approximately **3-second** conversation refresh while the chat panel is open and the host page is visible. New staff replies continue to appear promptly, with the same authorization and missed-message recovery.
- [x] When the panel is closed but the host page remains visible and a conversation session exists, refresh conversation presence/history no more often than approximately **once every 30 seconds**. That interval stays below the current 60-second visitor-departure window, so closing the panel while staying on the page does not make staff replies trigger an erroneous return email.
- [x] When the host tab is hidden, stop periodic conversation-history requests. On becoming visible again, fetch once immediately if a session exists and then use the appropriate open/closed interval. Opening the chat also fetches once immediately rather than waiting for the next timer tick.
- [x] A fresh visitor with no conversation session still creates no conversation and performs no history polling merely because the widget is embedded or opened. The existing site-wide analytics presence heartbeat remains unchanged by this ticket.
- [x] Prevent overlapping history GETs, including timer ticks during a slow request or rapid open/close/visibility changes. An older response cannot repaint a cleared or replaced conversation, and errors continue to retry without a busy-loop.
- [x] Keep visitor session credentials, server authorization, message creation, welcome/topics loading, email return decisions, and dashboard polling behavior unchanged. Do not add an AI API or optimize security tokens; this chatbot uses deterministic answer rules, not token-billed AI inference.
- [x] Measure and record request counts before and after for a fixed interval in four states: visible/open with a session, visible/closed with a session, hidden with a session, and no session. Show the expected order-of-magnitude drop for visible/closed full-history reads while open-chat cadence stays around 3 seconds. Verify a staff reply appears after reopening and that the 60-second presence/return-email behavior remains correct.

## Grounding

`src/widget/loader.ts` creates the iframe up front and hides/shows it with the launcher. Before this ticket, `src/app/widget/frame/page.tsx` started a 3-second `setInterval` for any stored session without checking whether the panel or host page was visible. Each history GET reads the full message list and updates `visitor_last_seen_at`. The server treats presence older than 60 seconds as departed; the analytics presence heartbeat is separately gated on page visibility and runs every 45 seconds. At a steady 3-second cadence, one saved session could make about 1,200 full-history GETs per hour even if the chat stayed closed. A 30-second closed cadence is about 120 per hour before network delays or tab pauses; these are code-derived estimates, not a measured bill.

The staff dashboard also refreshes its server-rendered conversation desk every 3 seconds while visible. That is a separate cost candidate; first measure ticket 59's effect, then prioritize the staff desk against real usage and any desired notification latency.

## Comments

2026-11-06: Filed after the user prioritized lower hosting/API cost and chose to keep approximately 3-second updates while a visitor has the chat open. No AI model is called by the current project, so AI token use is not the optimization target.
2026-11-06: Implemented. The parent loader sends open/closed and host visibility state to the iframe, with a ready handshake after hydration. The frame keeps 3-second open polling, uses a 30-second closed interval, pauses history reads while the host is hidden, and immediately catches up on open/visible transitions. A shared in-flight guard prevents overlapping initial and periodic GETs; generation checks keep stale responses from repainting a cleared chat. The bundled `public/widget/v1.js` was rebuilt.
- **Request evidence:** The old unconditional 3-second timer implies 10 periodic GETs in 30 seconds. The focused scheduling test models 1,200 open vs 120 closed GETs per hour, with zero hidden or sessionless reads. In a real Chrome run against the dev server, the open chat made 3 GETs in ~7.5 seconds; the closed panel made 1 in 32 seconds; a simulated hidden host made 0 in 35 seconds; visibility return made 1 immediate catch-up GET. Dev Strict Mode made 2 initial mount GETs in the first 9 seconds, a separate development-only effect replay. A second browser run showed a new staff reply on reopen with one immediate GET, and a fresh visitor made zero history GETs in 4 seconds.
- **Verification:** `tests/widget-history-polling.test.ts`, `tests/widget-presence.test.ts`, and `tests/embed-smoke.test.ts` pass (27 tests); `npm run typecheck` passes; widget bundle rebuilt; `git diff --check` passes. The 30-second closed interval stays under the existing 60-second visitor-departure window; the server presence and return-email code was not changed.
