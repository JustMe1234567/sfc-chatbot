ALTER TABLE staff_members ADD COLUMN "username" TEXT;

UPDATE staff_members
SET "username" = 'legacy_' || substr(replace("id", '-', ''), 1, 24)
WHERE "username" IS NULL;

CREATE UNIQUE INDEX idx_staff_members_username
  ON staff_members(lower("username"));
