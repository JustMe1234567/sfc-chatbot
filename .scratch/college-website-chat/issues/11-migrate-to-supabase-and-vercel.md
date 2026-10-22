# 11: Move persistent chat and staff data to Supabase before Vercel launch

**What to build:** The completed chatbot and protected dashboard run on Vercel with Supabase Postgres as their persistent store. The owner can verify migrated answers and conversation history, and staff can resume work after a controlled sign-in cutover.

**Blocked by:** 03: One reliable escalation email; 04: Staff claim and live reply; 05: Publish answer rules and topic buttons; 06: Ambiguous answers and handoff phrases; 07: Visitor email and secure return; 08: Manage staff access and conversation ownership; 09: Configured support hours; 10: Transcript retention.

**Status:** ready-for-agent

- [ ] Versioned Postgres migrations reproduce the production data model, including authentication, answer rules, visitor sessions, messages, staff actions, settings, and retention metadata.
- [ ] A documented, repeatable migration transfers SQLite records with stable identifiers and relationship checks; the owner verifies counts and representative histories before traffic switches.
- [ ] Staff sessions are revoked at cutover and staff sign in again with multifactor authentication. Password hashes and accounts are migrated only after compatibility is verified; otherwise the cutover includes a secure staff account reset path.
- [ ] Next.js server routes use Supabase Postgres through server-only credentials and enforce the same visitor, staff, and owner authorization checks. Neither WordPress nor a client bundle receives a Supabase service key or database connection string.
- [ ] The full public and staff API flow suite runs against Postgres, including concurrency, email, account disablement, reconnect, and retention. A Vercel preview verifies WordPress embedding and browser flows on desktop and mobile.
- [ ] A rollback and backup plan is documented; the college IT or site owner approves Vercel, Supabase, email delivery, data access, and retention before production launch.
- [ ] A security review checks exposed bundles and API responses for secrets, staff authorization on every route, visitor isolation, CSRF protection, login abuse controls, session revocation, and the WordPress embed boundary before production launch.
