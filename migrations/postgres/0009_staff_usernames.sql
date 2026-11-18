ALTER TABLE staff_members ADD COLUMN "username" TEXT;

UPDATE staff_members
SET "username" = 'legacy_' || left(replace("id", '-', ''), 24)
WHERE "username" IS NULL;

ALTER TABLE staff_members ALTER COLUMN "username" SET NOT NULL;

CREATE UNIQUE INDEX idx_staff_members_username
  ON staff_members(lower("username"));
