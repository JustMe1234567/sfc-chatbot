-- Ticket 66: required visitor contact on every new chat.
-- Every new conversation is created with the visitor's full name, email, and
-- phone number; the server refuses messages and topic choices on any
-- conversation still missing them, so pre-ticket (legacy) rows and locked
-- successors only become usable once the contact endpoint accepts details.
-- Both columns are plain nullable text: existing rows stay readable with the
-- staff-side "Visitor" fallback label until retention or deletion removes
-- them with the conversation.

ALTER TABLE conversations ADD COLUMN visitor_name TEXT;
ALTER TABLE conversations ADD COLUMN visitor_phone TEXT;
