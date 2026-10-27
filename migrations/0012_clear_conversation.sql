-- Ticket 14: the visitor's Clear conversation action.
-- replaced_by links a cleared conversation to the one fresh chat that
-- replaced it, so repeated or retried clear requests can never mint a second
-- successor. Deliberately no foreign key: the retention sweep purges closed
-- conversations independently, and a successor may be purged before the
-- conversation that links to it.

ALTER TABLE conversations ADD COLUMN replaced_by TEXT;
