# 10: Expire old conversations

**What to build:** The owner can set a transcript retention period. After a closed conversation passes that period, its messages and visitor contact details are removed, and old visitor links can no longer reopen it.

**Blocked by:** 07: Visitor email and secure return.

**Status:** ready-for-human

- [x] An owner can configure the retention period and see the current value in the dashboard.
- [x] An automated cleanup removes closed conversations, messages, and visitor email addresses after the configured period.
- [x] Active conversations are preserved until closed, and a deleted conversation is unavailable through the dashboard, widget session, and return link.
- [x] Cleanup is safe to rerun and records a minimal, non-transcript audit result for operators.
- [x] Automated tests cover the retention boundary, active conversation preservation, repeated cleanup, and revoked access.

## Comments

Implemented 2026-10-24 (ticket 10). Tests in `tests/transcript-retention.test.ts`. The retention period lives in the `settings` table (`transcript_retention_days`) behind owner-only `GET/PUT /api/staff/settings/transcript-retention` (`days: null` clears); the dashboard form sits on the notifications page for owners with a read-only summary for staff. Migration 0010 adds `conversations.closed_at` (stamped by the close route; the store method guards re-closing so the clock never restarts) and the `retention_runs` table. The sweep (`domain/retention.ts` through the `Store` port) removes expired closed conversations transactionally with their messages, visitor sessions, return tokens, and notification records — the dashboard then 404s, the widget credential 404s, and a mailed return link answers 410. Audit entries survive with their conversation link cleared, so staff accountability outlives the transcript. Cleanup rides ordinary staff traffic (every shared-inbox load) and runs immediately when the owner saves the setting. Verified against a production build: owner TOTP sign-in, the retention card rendering on the settings page, saving 30 days (page shows the saved value), rejecting 0 days, and clearing.

Judgment calls:

- While unconfigured, retention is off: closed transcripts are kept indefinitely, and a corrupt or hand-edited settings row reads as unconfigured — a bad value can never delete a transcript. The college provides the period as a launch configuration value.
- The cleanup is "automated" by riding staff traffic (inbox loads and settings saves) rather than a scheduler, which SQLite-local deployment has none of; ticket 11 should add a Vercel cron trigger so quiet periods still clean up.
- The boundary is strict: a conversation is removed once its period has *passed* (`closed_at < now − period`), so at exactly the boundary the transcript lasts one moment longer.
- The operator record is a purpose-built `retention_runs` row (counts only, never transcript text or contact details), not an `audit_log` entry: the sweep is a system action with no staff actor, and the audit trail records staff actions. A run that removes nothing records nothing, so reruns are free and the history lists actual removals; the form shows "No cleanup has removed anything yet" meanwhile.
- Conversations closed before migration get `closed_at = migration time`, starting a fresh period on upgrade rather than deleting old transcripts on arrival.
- The notification row for a deleted conversation goes with it: with the conversation gone there is nothing to retry, and its unique slot no longer matters.

