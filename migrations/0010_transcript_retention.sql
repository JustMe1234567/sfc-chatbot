-- Ticket 10: transcript retention.
-- closed_at starts the retention clock when staff close a conversation.
-- Conversations already closed before this migration get the migration's
-- moment, so an upgrade starts a fresh retention period instead of deleting
-- old transcripts on arrival. retention_runs is the operator-visible,
-- non-transcript record of what a cleanup removed: counts only, never message
-- text or contact details. Conversations are deleted by the retention sweep
-- only; it clears the conversation link of surviving audit rows first, so
-- staff accountability outlives the transcript without weakening the
-- foreign key that keeps it honest.

ALTER TABLE conversations ADD COLUMN closed_at TEXT;

UPDATE conversations
   SET closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE state = 'closed' AND closed_at IS NULL;

CREATE TABLE retention_runs (
  id TEXT PRIMARY KEY,
  ran_at TEXT NOT NULL,
  retention_days INTEGER NOT NULL,
  removed_conversations INTEGER NOT NULL
);
