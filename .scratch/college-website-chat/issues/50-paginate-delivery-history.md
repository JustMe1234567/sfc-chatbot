# 50: Paginate the Delivery history list

**Status:** ready-for-human

**Reference:** [Delivery history before pagination](../references/dashboard-delivery-history-pagination-before.png)

**What to build:** Replace the Delivery history list on the Email alerts dashboard (`src/app/dashboard/notifications/page.tsx`) with paginated output. Today the server component loads every notification via `listNotifications` and renders all rows in one long `<ol>`; with 18 delivered alerts the section becomes an unbounded scroll. Show a fixed number of rows per page with real pagination controls, newest first, without changing how alerts are recorded or retried.

- [x] Delivery history renders at most **10 rows per page**. The existing newest-first ordering is preserved; page 1 always shows the newest attempts.
- [x] Pagination is **URL-driven via the `page` search parameter** (e.g. `/dashboard/notifications?page=2`), resolved server-side with the current Next.js server-component conventions for reading the request URL. The page stays a server component; no client-side row state.
- [x] Out-of-range, non-numeric, or `page=0`/negative values fall back to page 1 rather than erroring. `page=1` and no parameter render the same URL-canonical first page.
- [x] The data layer gains limit/offset support so a page query fetches only its own rows plus a **total row count** for computing page links. The full table is never read to render one page.
- [x] Pagination controls show Previous/Next plus numbered page links, windowed when there are many pages (first, last, and pages around the current one). The current page carries `aria-current="page"`; controls are real links with visible focus, keyboard reachable, and remain usable at 360px width.
- [x] Previous is omitted or disabled on page 1 and Next on the last page, without dead links.
- [x] The **`N delivered` / `N failed` summary badges keep counting all notifications**, not just the current page.
- [x] The empty state ("No email alerts yet") still renders exactly when there are zero notifications total, and shows no pagination controls.
- [x] Per-row behavior is unchanged on every page: status badge with text (never color alone), attempt count, locale timestamp, recipient/error line, and the Retry button on failed rows still triggers the existing retry flow.
- [x] Links elsewhere that target the notifications page (dashboard navigation, back links) continue to work with and without the `page` parameter.

## Context

Ticket 49 redesigned this page into the compact configuration-plus-log layout now on `main` (commit `735f506`). The list itself was left unbounded: `listNotifications` in `src/mail/notifications.ts` returns every row and the server component maps all of them. The screenshot reference shows the result — 18 delivered rows as one continuous scroll. Pagination is UI/data-shape only; alert recording, retry semantics, recipient handling, and retention rules are out of scope and must not change.

## Comments

2026-11-05: Filed from the user's request ("make it a pagination") with the current Delivery history screenshot as reference. Ten rows per page and the `page` search parameter are recorded as the recommended defaults so the ticket needs no further decisions before implementation.

2026-11-05: Implemented (`Status:` → ready-for-human).

- **Data layer** (`src/mail/notifications.ts`): `NOTIFICATIONS_PAGE_SIZE = 10`, `listNotificationPage(db, page)` → only that page's rows via `LIMIT ? OFFSET ?` (newest first; an `id DESC` tie-break keeps page boundaries stable when attempts share a `created_at` instant — a deliberate ordering refinement over the old untied `created_at DESC`), and `notificationStatusCounts(db)` → `{total, delivered, failed}` over ALL rows via one `GROUP BY`. The page render runs exactly one aggregate (the counts) plus the page slice — no second COUNT, no full-table read. SQL is placeholder-portable across SQLite/Postgres (ADR 0003) with bigint-string coercion. The unpaginated `listNotifications` is kept for the staff retry API, unchanged.
- **Pager math** (`src/app/dashboard/notifications/pagination.ts`, pure): `resolveNotificationPage` — digits-only parse (so `0x10`/`1e1`/`2.5` are junk, not clever page numbers), anything non-numeric, `<1`, or past the last page falls back to page 1; `notificationPageLinks` — every page while ≤ 7 total, else first/last/±1 window with gaps (named `PAGER_WINDOW_MAX_PAGES`); discriminated `NotificationPageLink` union.
- **Page**: Next 16 `searchParams: Promise<...>` prop resolved server-side; stays a server component; badges and empty state key on `counts.total`; pager is real `<Link>`s (`aria-current="page"` on the live page, Previous omitted on page 1, Next omitted on the last page), 44px touch floor, `flex-wrap` for narrow widths, focus-visible rings. Retry uses `router.refresh()`, which refetches the current URL — the browser proof shows retry from page 2 stays on page 2 and the totals update (16→17 delivered).
- **Tests**: `tests/notifications-pagination.test.ts` (7: page slice/order, all-row counts, junk fallbacks incl. hex/exponent, windowed links, server-component pins, staff API stays unpaginated, pager CSS floors).
- **Browser certification** (`scripts/notifications-pager-shots.mjs`, idempotent): signs in through the real UI, seeds 23 notifications with per-row targetable text, asserts 10-row page 1 newest-first, totals counting everything, numbered/Next/Previous navigation with aria-current (Next omitted on the last page), junk/zero/negative/out-of-range params → page 1, the header nav link (no param) landing on the canonical first page, retry from page 2 through the real endpoint, and the empty state with no pager; screenshots at 1280/760/390/360 with zero overflow and zero page errors.
- **Review fixes applied** (two-axis): dropped the unused `pageSize` parameters (AGENTS.md: no speculative configurability); removed the page query's own COUNT (the total comes from the counts query — no double aggregate); pager math moved out of the mail module into `notifications/pagination.ts`; digits-only parsing (was `Number()`, which accepted `0x10`→16); the out-of-range clamp was corrected to the spec's page-1 fallback; script seed deduplicated; inbound-link checkbox now exercised live.
- **Screenshots**: before = `references/dashboard-delivery-history-pagination-before.png` (user-supplied); after = `references/shots-pager/after-pager-{1280,page2-760,390,360}.png`.
- Suite 243 passed + 3 env-skipped; typecheck and production build clean.
