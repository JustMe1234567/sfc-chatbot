-- Ticket 58: the answer lifecycle beyond draft/published. Mirrors
-- migrations/0014 on SQLite: `archived` and `trashed` join the status set
-- (trashed rows carry trashed_at, the fixed 30-day purge clock), and the
-- audit trail gains the matching actions. Postgres CHECK constraints drop
-- by their auto-generated names (<table>_<column>_check).

ALTER TABLE answer_rules DROP CONSTRAINT answer_rules_status_check;
ALTER TABLE answer_rules ADD CONSTRAINT answer_rules_status_check
  CHECK (status IN ('draft', 'published', 'archived', 'trashed'));
ALTER TABLE answer_rules ADD COLUMN IF NOT EXISTS trashed_at TEXT;

ALTER TABLE audit_log DROP CONSTRAINT audit_log_action_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check
  CHECK (action IN (
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
  ));
