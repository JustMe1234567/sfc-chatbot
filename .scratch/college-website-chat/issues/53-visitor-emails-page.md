# 53: Visitor emails page — surface captured follow-up emails with conversation links

**Status:** ready-for-human

**Reference:** [Widget email capture at handoff](../references/widget-email-capture-reference.png)

**What to build:** Add a **Visitor emails** option to the dashboard listing every conversation where a visitor left a follow-up email during the chat-with-a-human flow, each entry linking straight to that conversation, and show the captured email on the admin side of the conversation itself. No capture work is needed: the widget already stores the address (`conversations.visitor_email` via `setConversationEmail`, ticket 07) and the mailer already uses it to send the visitor their return link — but nothing in the dashboard or staff API ever reads it, so staff cannot see who asked to be contacted.

## The emails list

- [x] A new dashboard page (e.g. `/dashboard/emails`) with its own nav option **Visitor emails**, visible to owners and staff (the roles that work handoffs), following the existing `DashboardHeader` area/role pattern. If ticket 52's sidebar has landed, the item joins the sidebar with an envelope-style SVG icon; if not, it joins the current nav row — either way it is one more entry in the shared NAV list, not a separate chrome.
- [x] The list is **derived live from `conversations.visitor_email IS NOT NULL`** — no new table, no copied rows. When a conversation is purged by retention, manual delete (ticket 51), or clear-history, its email entry disappears with it automatically.
- [x] Rows show newest first: the email address, the conversation state label, and when it was captured (or last activity). Rows reuse the dashboard's established list-row styling.
- [x] Each row links to its conversation at `/dashboard/inbox/[id]`, opening the same transcript pane staff get from Conversations/History. The link is the whole row, per the existing row pattern — no nested interactive elements inside it.
- [x] If a visitor re-enters an email, the list shows the latest stored value only (the store overwrites on re-submit).
- [x] Empty state renders when no conversation has an email: plain-language explanation that entries appear when a visitor asks for a human and leaves an address. No pagination controls when empty.
- [x] The list uses the same URL-driven pagination pattern as ticket 50's delivery history (10 per page, `page` search parameter, out-of-range falls back to page 1). If ticket 50 has not landed yet, implement the same pattern here rather than an unbounded list.

## The conversation side

- [x] The admin conversation pane shows the visitor's follow-up email when one exists — in the header/meta area, labeled clearly (e.g. "Follow-up email") and never inside the transcript as if it were a message. Conversations without an email show nothing (no empty placeholder).
- [x] From that pane the staff member can see at a glance which visitor is reachable, complementing the return-link email the system already sends.

## Access and safety

- [x] The page is a server component guarded by `requireStaff` with the same role rules as the nav item (owner + staff); unauthenticated or wrong-role requests never see an address.
- [x] Email addresses are rendered as text for staff follow-up. No third-party embeds, no `mailto:` inside the row link.
- [x] Retention and deletion behavior is unchanged — this ticket only reads what the existing lifecycle already removes.

## Tests

- [x] Store tests (SQLite and Postgres): the email listing returns only conversations with an email, newest first, with the paging window; re-submitted emails surface the latest value; purged conversations drop out.
- [x] Page/route tests: role gating for the nav item and page; rows include the address and a link to `/dashboard/inbox/<id>`; empty state when no emails exist.

## Context

Ticket 07 built the capture: at handoff the widget offers an optional email (`POST /api/v1/conversations/[id]/email`), validated and rate-limited, stored on the conversation; declining stores nothing (there is a declined screenshot variant in references). `mail/visitorReturn.ts` mails the return link to that address, and retention (tickets 10/47) purges it with the conversation — so the data, its privacy lifecycle, and its deletion are all solved. The gap is purely staff visibility, which is what this ticket closes. Nav ordering note: ticket 52 freezes the sidebar to "the existing five areas"; this ticket adds a sixth, so whichever lands second amends the shared NAV list — the header/sidebar component is the single seam for both.

## Comments

2026-11-05: Filed from the user's request ("when a user enters an email on the chatbot chat with a human, the emails will be saved on the admin dashboard… a link to that conversation") with the widget's handoff email prompt as reference. Capture already existed, so the ticket records that discovery and scopes to surfacing: a derived Visitor emails list page plus the email on the admin conversation pane, reusing the ticket-50 pagination pattern.
2026-11-05: Implemented and verified. The list derives live from `conversations.visitor_email IS NOT NULL` through two new Store port methods (`listConversationsWithEmail(page, pageSize)` page slice + `countConversationsWithEmail()` total), implemented on both the SQLite and Postgres stores with the same `last_activity_at DESC, id DESC` ordering (conversations carry no seq, so the id is the shared deterministic tie-break). `/dashboard/emails` reuses the ticket-50 shape: server component under `requireStaff` + `STAFF_ROLES`, `emails/pagination.ts` pager math (10 per page, digits-only `page` param, junk/out-of-range falls back to page 1, windowed links with gaps), rows in the delivery-history row language (email as plain text, desk state chip, last-activity time) as one whole-row link to `/dashboard/inbox/[id]`; empty state renders without a pager. The shared NAV list gains the sixth entry beside Conversations with a hand-authored envelope Mark (ticket 52's count pin amended 5→6 as the Context anticipated); the desk pane header shows "Follow-up email <address>" on its own meta line, never inside the transcript, and shows nothing when no address exists. Retention/deletion untouched — purged conversations drop out of the listing with no bookkeeping.
- **Tests**: `tests/visitor-emails-page.test.ts` (12: store slice newest-first only-with-email, page windows + past-end, all-row count, re-submit surfaces latest value, purge drops the entry, pager junk fallbacks incl. hex/exponent, windowed links, page server-component pins, nav-entry + role pins, pane-meta pins, CSS class pins) — portable, runs on SQLite and Postgres via `CHATBOT_TEST_POSTGRES_URL`. `tests/dashboard-sidebar.test.ts` amended (6 marks).
- **Browser certification** (`scripts/visitor-emails-shots.mjs`, idempotent): signs the owner in through the real UI (fresh TOTP enrollment), seeds 12 email conversations (+2 without, which never surface), asserts the 10-row newest-first page as whole-row links into the desk, the pane's follow-up email line, page-2 order with no dead Next, junk param fallbacks, the nav entry landing on the canonical first page, and the empty state with no pager; screenshots at 1280/760/390/360 plus the pane at 1280, zero overflow and zero page errors.
- **Screenshots**: `references/shots-emails/after-emails-{1280,page2-760,390,360}.png` + `after-emails-pane-1280.png`.
- Two-axis review: Standards clean (STATE_CHIPS map duplicated from the desk noted as a judgement call; kept for the established per-component pattern); Spec complete with no missing checkboxes. Suite 274 passed + 3 skipped; `restart-persistence` failed environmentally (the long-running dev server holds the Next dev lock; file untouched by this ticket); typecheck and production build clean.

