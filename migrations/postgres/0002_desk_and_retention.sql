-- Postgres schema, part 2 of 3 (tickets 08, 10, 12, 14): staff-management
-- support and transcript retention. Mirrors migrations/0008 and 0010-0012 on
-- SQLite; the desk/retention columns of conversations are part of 0001's
-- final shape.

-- The accountability record of security-sensitive staff actions. Audit rows
-- outlive transcripts: the retention purge detaches (never deletes) them.
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  rule_id TEXT,
  actor_id TEXT NOT NULL REFERENCES "user"(id),
  action TEXT NOT NULL CHECK (action IN (
    'conversation_claimed',
    'conversation_released',
    'conversation_transferred',
    'conversation_replied',
    'rule_created',
    'rule_revised',
    'rule_published',
    'rule_unpublished',
    'staff_invited',
    'staff_disabled'
  )),
  detail TEXT,
  created_at TEXT NOT NULL,
  seq BIGSERIAL
);

CREATE INDEX IF NOT EXISTS idx_audit_conversation ON audit_log (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_rule ON audit_log (rule_id, created_at);

-- The operator-visible record of one cleanup pass (counts only).
CREATE TABLE IF NOT EXISTS retention_runs (
  id TEXT PRIMARY KEY,
  ran_at TEXT NOT NULL,
  retention_days INTEGER NOT NULL,
  removed_conversations INTEGER NOT NULL,
  seq BIGSERIAL
);
