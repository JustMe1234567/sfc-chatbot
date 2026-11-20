# 48: History tab links to a route that renders the live desk

**Status:** ready-for-human

**What to build:** Make the desk's History navigation actually reach the History view.

- [ ] The desk tab labeled History (`conversation-desk.tsx`, deskTabs) links to `/dashboard/inbox?view=history`, but the inbox page ignores the query entirely and always renders `view="active"`. The real archive route is `/dashboard/inbox/history` (ticket 12). Point the tab (and the transcript view's back link for history conversations, `deskBack`) at the route that exists.
- [ ] Verify end to end: clicking History from the desk tabs shows the archive heading and rows; opening a history conversation deep-links correctly and its back link returns to the archive.
- [ ] A regression check should pin the link target (the archived view must not be reachable only by URL).

## Context

Found while verifying ticket 44: the headless check for "history rows carry no status treatment" could not reach the archive through the tab — `?view=history` renders the live desk, so staff clicking History see Incoming/Active again. Pre-existing since ticket 12 (`git log` shows the hrefs unchanged); the dedicated `inbox/history` route has existed the whole time. Ticket 44's certification uses the real route directly.

## Comments

2026-11-05: Filed from the ticket-44 verification run.

2026-11-05: Implemented (`Status:` → ready-for-human). The desk's History tab and the transcript's back link for history conversations now both target `/dashboard/inbox/history` — the archive route that has existed since ticket 12 — instead of the `?view=history` query the inbox page ignores. The staff API's own `?view=history` query (a separate, working mechanism) is untouched. Regression pins: `tests/history-links.test.ts` (tab + back link target, no dead-form hrefs anywhere in the desk) and two live checks in `scripts/desk-status-shots.mjs` — clicking the History tab reaches the archive heading, and a history conversation's back link carries the archive href. Desk certification green (19 checks); suite 226 passed.
