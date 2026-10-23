-- Ticket 05: accountability for content publishing. published_by records
-- which staff account last published the rule (its answer is the live,
-- reviewed content); reviewed_at is that approval moment. Seeded published
-- rules carry their seed timestamp as the review date with no named
-- publisher.

ALTER TABLE answer_rules ADD COLUMN published_by TEXT;
ALTER TABLE answer_rules ADD COLUMN reviewed_at TEXT;

UPDATE answer_rules SET reviewed_at = updated_at WHERE status = 'published';
