-- Ticket 08: staff management and the accountability audit trail.
-- One row per security-sensitive staff action, conversation- or rule-scoped
-- (staff administration actions carry neither id). Actor names are resolved
-- from the staff account table at display time, so a rename follows the
-- person; only the actor id is recorded here.

CREATE TABLE audit_log (
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
    'staff_invited',
    'staff_disabled'
  )),
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_audit_conversation ON audit_log(conversation_id, created_at);
CREATE INDEX idx_audit_rule ON audit_log(rule_id, created_at);
