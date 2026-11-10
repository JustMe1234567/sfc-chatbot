-- Ticket 66: required visitor contact on every new chat (Postgres mirror of
-- migrations/0015_visitor_contact.sql). New conversations carry the
-- visitor's full name, email, and phone; legacy rows keep NULL until
-- retention or deletion removes them with the conversation.

ALTER TABLE conversations ADD COLUMN visitor_name TEXT;
ALTER TABLE conversations ADD COLUMN visitor_phone TEXT;
