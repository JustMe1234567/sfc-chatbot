CREATE TABLE audit_log_credentials (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id),
  rule_id TEXT REFERENCES answer_rules(id),
  actor_id TEXT NOT NULL REFERENCES staff_members(id),
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
    'staff_created',
    'staff_password_reset',
    'staff_mfa_reset',
    'staff_disabled'
  )),
  detail TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO audit_log_credentials
  (id, conversation_id, rule_id, actor_id, action, detail, created_at)
SELECT id, conversation_id, rule_id, actor_id, action, detail, created_at
FROM audit_log;

DROP TABLE audit_log;
ALTER TABLE audit_log_credentials RENAME TO audit_log;
CREATE INDEX idx_audit_conversation ON audit_log(conversation_id, created_at);
CREATE INDEX idx_audit_rule ON audit_log(rule_id, created_at);
