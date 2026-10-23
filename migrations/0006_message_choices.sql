-- Ticket 06: topic choices offered to the visitor. A bot message can carry
-- the matching rules as JSON [{id, topic}]; the widget renders them as
-- buttons and a selection answers from the chosen rule. Choices persist with
-- the message so a reload renders the same offer.

ALTER TABLE messages ADD COLUMN choices TEXT;
