-- Ticket 82: two-factor authentication is removed from the staff stack.
-- The factor bookkeeping columns leave the application table; Supabase
-- Auth's enrolled factors are removed separately (scripts/remove-enrolled-factors.ts).
ALTER TABLE staff_members DROP COLUMN "twoFactorEnabled";
ALTER TABLE staff_members DROP COLUMN "mfaRecoveryApprovedAt";
