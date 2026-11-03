# 41: Show a welcome message when the visitor opens a fresh chat

**Status:** ready-for-human

**What to build:** When a visitor opens the chatbot with no existing conversation messages, show a short welcome message in the transcript so the widget does not begin as an empty conversation.

- [ ] The welcome appears in the transcript when the widget opens with no existing messages.
- [ ] It is visually presented as a bot message and announced through the existing message-log live region without stealing focus from the composer.
- [ ] It appears only once for a fresh conversation; closing and reopening the widget, reloading the page, or resuming an existing conversation must not duplicate it.
- [ ] Existing conversations continue to show their saved history without inserting a new welcome message above or below it.
- [ ] The welcome does not create a server-side conversation or visitor credential by itself; the first visitor question continues to start the conversation.
- [ ] Suggested-topic buttons and the topicless guidance text remain usable and are not replaced by the welcome.
- [ ] Authorized admins can edit the welcome message from the dashboard rather than changing source code.
- [ ] The dashboard setting shows the currently published welcome text, supports saving an updated value, validates a sensible non-empty length limit, and displays clear success/error feedback.
- [ ] The public widget reads the published welcome setting from the server; a dashboard update appears on the next fresh widget open without requiring a rebuild or redeploy.
- [ ] Only an authorized staff role with settings/content-management permission can read or update the setting; public and unauthorized requests are rejected.
- [ ] If the setting cannot be loaded, the widget fails safely with the existing default welcome copy rather than blocking chat.
- [ ] The message fits without clipping at 360px, phone, and desktop widths and follows the widget's existing bot-message and reduced-motion treatment.
- [ ] Add coverage for fresh open, reopen without duplication, existing-history behavior, authorized dashboard editing, rejected unauthorized updates, validation, and the widget receiving the updated copy.

## Decisions needed

- ~~Approve the initial/default welcome copy.~~ **DECIDED 2026-11-03:** default copy is **"Hi! How can I help you today?"** (user-approved; admins can change it later in the dashboard).
- ~~Confirm whether the welcome should remain a local presentation-only message, as proposed, or be persisted as the first bot message after a conversation begins.~~ **DECIDED 2026-11-03:** **presentation-only** (user-approved) — rendered locally from the published setting, never stored as a message, never part of the staff transcript.

## Context

The current specification requires an openable widget, suggested topics, and typed questions, but it does not request an automatic greeting. The current empty state only shows **“Ask us your question.”** when no published topic buttons exist. This ticket adds the newly requested welcome behavior and makes its copy editable through the existing admin dashboard. Store it as a server-side setting alongside the project's other configurable content; do not expose broader settings or staff capabilities through the public widget endpoint.

## Comments

2026-11-03: Filed from the user's request for a welcome message when opening the chatbot. Marked `needs-info` pending approval of the exact copy and persistence behavior.

2026-11-03: Expanded at the user's request so authorized admins can edit and publish the welcome message from the dashboard, with permission checks, validation, safe fallback copy, and end-to-end coverage.

2026-11-03: Decisions taken by the user — default copy "Hi! How can I help you today?" approved; welcome is presentation-only (never persisted as a message, never in the staff transcript). Ticket unblocked to `ready-for-agent`.

2026-11-04: IMPLEMENTED (`ready-for-human`).

**Widget (presentation-only, per the decided behavior):** a mount with no stored session is eligible; the greeting is fetched from the published setting (`GET /api/v1/welcome`, public + rate-limited like topics) with the domain default as the safe fallback when the read fails. It renders as a bot-styled bubble inside the `role="log"` live region (announced on arrival, no focus steal), lives only in the current mount's view, and is never sent to the server — no conversation, no visitor credential (browser-verified: sessionStorage holds no session after a fresh greet). An existing conversation never greets (session at mount ⇒ history restores instead); resuming after reload must not greet, asserted negatively in the headless script; Clear conversation re-greets the successor with the current published wording. The "reload with no conversation greets again" reading is the presentation-only consequence — nothing may persist "greeted" — logged here as the accepted interpretation of the reopen/reload box.

**Dashboard:** a Welcome message card on the Answers page (owner + editor, `ANSWER_RULE_ROLES`, matching where the other visitor-facing copy lives) reads the effective text, validates server-side (1–280 chars after trim; client `maxLength` single-sourced from `MAX_WELCOME_LENGTH`), and returns the trimmed saved value. New setting accessors in `src/settings.ts` follow the house shape (corrupt row reads as default); the copy constant + validator live in the client-safe `src/domain/welcome.ts`.

**Tests:** `tests/welcome.test.ts` (API seam): default served credential-free, owner publish + next-open visibility, dashboard GET, empty/whitespace/oversized/non-string rejections, 401 anonymous with trusted origin, 403 staff role. `embed-smoke` pins the endpoint + fallback + presentation-only slice. Headless (`topics-shots.mjs`): fresh open greets, no credential minted, resumed conversations never re-greet, all prior ticket flows green against a production build.

**Review** (two-axis `/code-review`): applied — deduped the widget fetch into `fetchWelcomeText()`, removed a dead eligibility re-check, single-sourced the 280 limit (form + error copy), added the runtime no-credential assertion and a GLOSSARY "Welcome message" entry. Accepted as-is: success/error share the house `hint` style (consistency; ticket 42 systematizes feedback); widget behavior covered at the browser layer rather than vitest (no DOM env — the project's stated seam).

**Incidental fix, ticket 39:** its browser proof asserted staff history retention by fetching the old conversation **with the revoked visitor credential** — unpassable by design (clear revokes the credential immediately; glossary/ticket 14) and never executed in its own run. Replaced with the checkable contract: the old credential now draws 401/404 (existence-leak-safe 404 included), with staff retention pointed at `tests/conversation-clear.test.ts`. Also stabilized the strip's smooth-scroll fade wait (400→700ms) after a flake.
