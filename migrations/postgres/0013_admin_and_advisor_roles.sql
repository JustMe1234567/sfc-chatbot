-- Ticket 102: Owner, Staff, and Editor collapse into Admin and Admissions
-- Advisor. staff_members.role carries no CHECK constraint on either engine,
-- so the rename is a plain data update: owner becomes admin, and staff and
-- editor both become admissions_advisor. Nothing else about an account
-- changes — ids, the credential linkage, ban flags, and every foreign key
-- pointing at these rows keep their values — and open sessions stay valid,
-- because the role is read again on each request.
UPDATE staff_members SET "role" = 'admin' WHERE "role" = 'owner';
UPDATE staff_members SET "role" = 'admissions_advisor' WHERE "role" IN ('staff', 'editor');
