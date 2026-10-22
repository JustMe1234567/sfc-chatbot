-- Owner-configurable launch settings and email notification records.
-- The unique index on (type, conversation_id) is the database-enforced
-- guarantee that one conversation produces one escalation alert, no matter
-- how many times delivery is retried or the escalation is re-raised.

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  recipients TEXT NOT NULL,
  delivered_to TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  UNIQUE (type, conversation_id)
);

CREATE INDEX idx_notifications_status ON notifications(status, created_at);
