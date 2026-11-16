-- Application-owned staff identities. Supabase Auth owns credentials,
-- sessions, and MFA factors; application roles and account status stay here.
ALTER TABLE "user" RENAME TO staff_members;

ALTER TABLE staff_members ADD COLUMN "supabaseUserId" TEXT;
ALTER TABLE staff_members ADD COLUMN "invitationStatus" TEXT NOT NULL DEFAULT 'accepted'
  CHECK ("invitationStatus" IN ('pending', 'sent', 'accepted'));
ALTER TABLE staff_members ADD COLUMN "mfaRecoveryApprovedAt" TEXT;

CREATE UNIQUE INDEX idx_staff_members_supabase_user
  ON staff_members("supabaseUserId")
  WHERE "supabaseUserId" IS NOT NULL;
