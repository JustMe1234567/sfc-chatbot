# 32: Infra/docs polish batch

**Status:** ready-for-human
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

2026-11-12: Implemented in commit 38a70af (docs-only, no behavior change). (1) Cache-bust: documented the bump procedure in a docblock on wordpress/sfc-chatbot.php (the ticket's allowed alternative to auto-version; the stable v1.js URL is a deliberate contract per next.config.ts) — after a loader change, bump the wp_enqueue_script $ver argument (null → e.g. 'v1.1') and WordPress appends ?ver= for the cache bust; no renaming anywhere else. (2) migrations/README.md now carries the mapping table (physical DDL location per piece — pg 0001 = SQLite 0001-0007 + the ticket-12 desk columns and ticket-14 replaced_by folded into CREATE TABLE; pg 0002 = audit_log from 0008 + retention_runs from 0010; 0003-0006 = 0013-0016), the true 0009 story (ticket 09 fadffa1 added no migration — support hours live in 0003's settings table; ticket 10 committed 0010 directly; no 0009 ever existed in any commit), and fixed pg 0001's false "mirrors migrations/0001-0009" header claim. The review caught two ticket-number errors in my first table draft (0014 is ticket 58 not 55; replaced_by is in pg 0001 not 0002) — corrected against the DDL before commit. (3) twoFactor dialect defaults NOTED in the README (aligning SQLite = table rebuild for zero gain; the data migration copies values verbatim). (4) handoff-zcode.md's stale "Build ticket 02 next" instruction replaced with an explicit do-not-follow-as-work-order pointer to the tracker's Status lines. (5) Tickets 13/14/16 deduped: the first ## Comments block (verified a verbatim subset of the second before deletion) removed; one heading remains per file. php -l clean; embed-smoke's plugin pins unaffected; the suite/typecheck churn in the shared tree at commit time is the concurrent ticket 69/70 sessions' in-flight work (their rebuilt loader trips the no-api pin mid-development), not this diff.