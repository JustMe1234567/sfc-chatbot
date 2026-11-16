# Supabase Auth for hosted staff access

Status: accepted

Supabase Auth owns staff passwords, email invitations, sessions, and mandatory TOTP factors, while the application database owns staff membership, status, and owner/staff/editor permissions. This supersedes ADR-0001's Better Auth and fully offline login choice: localhost now uses the dedicated hosted test project, protected requests verify both the current Supabase session and the linked active staff account, and visitor sessions remain separate. The migration starts with fresh staff identities and configuration-only data transfer so the original database stays intact.
