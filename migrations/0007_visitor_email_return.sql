-- Ticket 07: visitor follow-up email and secure return.
-- visitor_email is requested only at escalation and is optional; it is the
-- destination for one return-link notification. visitor_last_seen_at is
-- touched on every authenticated visitor request: a staff reply arriving
-- while it is fresh reaches a visitor still on the page (no email needed),
-- and only a stale timestamp means the return link is emailed. Return
-- tokens store only their SHA-256 hash, expire, and are single-use via the
-- used_at marker; the raw token exists only inside the emailed link. The
-- notification row carries no link: each delivery (and staff retry) mints a
-- fresh token, so a retried email can never carry a stale one.

ALTER TABLE conversations ADD COLUMN visitor_email TEXT;
ALTER TABLE conversations ADD COLUMN visitor_last_seen_at TEXT;

CREATE TABLE return_tokens (
  token_hash TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE INDEX idx_return_tokens_conversation ON return_tokens(conversation_id);
