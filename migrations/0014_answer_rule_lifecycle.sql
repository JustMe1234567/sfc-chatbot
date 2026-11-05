-- Ticket 58: the answer lifecycle beyond draft/published. `archived` and
-- `trashed` join the status set (trashed rows carry trashed_at, the fixed
-- 30-day purge clock), and the audit trail gains the matching actions.
-- SQLite cannot alter a CHECK constraint, so both constrained tables are
-- rebuilt. The runner keeps foreign keys on and wraps the file in a
-- transaction, and a parent table cannot be dropped while a child still
-- references it (the drop's implicit delete would violate the child rows),
-- so audit_log — the only child of answer_rules — is first copied to an
-- FK-less temp backup and dropped; answer_rules is then rebuilt freely and
-- the audit rows return into the reshaped table.

CREATE TEMP TABLE audit_backup AS SELECT * FROM audit_log;

DROP TABLE audit_log;

CREATE TABLE answer_rules_lifecycle (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  response TEXT NOT NULL,
  link TEXT,
  phrases TEXT NOT NULL,
  keywords TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived', 'trashed')),
  updated_at TEXT NOT NULL,
  published_by TEXT,
  reviewed_at TEXT,
  trashed_at TEXT
);

INSERT INTO answer_rules_lifecycle
  (id, topic, response, link, phrases, keywords, status, updated_at, published_by, reviewed_at, trashed_at)
SELECT id, topic, response, link, phrases, keywords, status, updated_at, published_by, reviewed_at, NULL
FROM answer_rules;

DROP TABLE answer_rules;
ALTER TABLE answer_rules_lifecycle RENAME TO answer_rules;

CREATE TABLE audit_log_lifecycle (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id),
  rule_id TEXT REFERENCES answer_rules(id),
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
    'rule_duplicated',
    'rule_archived',
    'rule_trashed',
    'rule_restored',
    'rule_purged',
    'staff_invited',
    'staff_disabled'
  )),
  detail TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO audit_log_lifecycle
  (id, conversation_id, rule_id, actor_id, action, detail, created_at)
SELECT id, conversation_id, rule_id, actor_id, action, detail, created_at
FROM audit_backup;

DROP TABLE audit_backup;
ALTER TABLE audit_log_lifecycle RENAME TO audit_log;

-- The indexes from ticket 0008, which the table rebuild dropped.
CREATE INDEX idx_audit_conversation ON audit_log(conversation_id, created_at);
CREATE INDEX idx_audit_rule ON audit_log(rule_id, created_at);
