-- Contact requests (ticket 69): a visitor's explicit ask to be reached —
-- medium "chat" rides the existing waiting-for-staff flow, "email" and
-- "phone" leave the bot active and wait for staff to mark them contacted.
-- One OPEN request per conversation is a database guarantee (the partial
-- unique index), so concurrent or retried requests can never duplicate.

CREATE TABLE contact_requests (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  medium TEXT NOT NULL CHECK (medium IN ('chat', 'email', 'phone')),
  status TEXT NOT NULL CHECK (status IN ('open', 'completed')),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  completed_by TEXT
);

CREATE UNIQUE INDEX idx_contact_requests_one_open
  ON contact_requests (conversation_id) WHERE status = 'open';

CREATE INDEX idx_contact_requests_conversation
  ON contact_requests (conversation_id, created_at);
