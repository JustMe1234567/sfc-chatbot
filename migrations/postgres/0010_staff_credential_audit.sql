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
    'staff_created',
    'staff_password_reset',
    'staff_mfa_reset',
    'staff_disabled'
  ));
