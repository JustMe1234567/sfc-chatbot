# 32: Infra/docs polish batch

**Status:** ready-for-agent
**Priority:** P3 — polish, queued (non-gating)
**Found by:** pre-testing audit 2026-10-30 (docs + spec + health passes)

**What to fix, batched:**

- [x] Widget cache-busting is manual: `scripts/build-widget.ts:10` always overwrites the same `public/widget/v1.js` and `wordpress/sfc-chatbot.php:31` enqueues with `$ver = null`, so loader changes inside "v1" get stale until someone hand-renames in three places. Either auto-version (content hash in `$ver`) or document the bump procedure.
- [x] The migration numbering story lives nowhere: SQLite files jump `0008` → `0010` and `migrations/postgres/0001_auth_and_chat.sql:3` claims to mirror "migrations/0001-0009" — a file that doesn't exist. One paragraph in `migrations/` (or the README) explaining the gap prevents the next agent from "fixing" it.
- [x] `twoFactor` column defaults differ between dialects (`migrations/0002_auth_and_mail.sql:69`: SQLite `NOT NULL DEFAULT 1/…` vs Postgres nullable/`DEFAULT false`) — harmless today (the data migration copies values verbatim), but align or note it.
- [x] `.scratch/college-website-chat/handoff-zcode.md:3` still says "Build ticket 02 next" while tickets through 18 are implemented — a fresh agent could follow it. Update or delete the stale instruction.
- [x] Tickets 13, 14, and 16 contain duplicated verbatim `## Comments` blocks — copy-paste drift in the tracker. Deduplicate.

## Comments

2026-10-30: Filed from the audit. Batched: each is minutes of tracker/config work with no behavior change.
