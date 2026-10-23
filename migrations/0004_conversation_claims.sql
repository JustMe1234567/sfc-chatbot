-- Human takeover: one staff member owns a claimed conversation at a time.
-- The claim is released by closing (or by ticket 08's release/transfer).

ALTER TABLE conversations ADD COLUMN claimed_by TEXT REFERENCES "user"("id");
ALTER TABLE conversations ADD COLUMN claimed_at TEXT;
