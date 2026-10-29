# Postgres on Supabase for production; SQLite stays the dev default

The application runs unchanged on two backends. Development keeps the
SQLite file (fast, zero-provisioning, one-file backup); production on Vercel
uses Supabase Postgres, chosen per the original architecture for its managed
backups, connection pooling, and the college's preference for a hosted
platform. The switch is one environment variable: `DATABASE_URL` selects
Postgres, its absence selects SQLite.

The port keeps the properties the earlier tickets proved on SQLite:

- All SQL lives in two per-backend `Store` implementations behind the
  `Store` port; every guarded write keeps its exact shape — conditional
  UPDATEs decide races, `sql.begin` transactions hold multi-step invariants
  (the clear protocol, the retention purge, redemption-plus-mint), and
  `seq` identity columns replace SQLite's `rowid` as the monotonic
  tie-break. Application timestamps remain ISO-8601 UTC text, so the data
  migration copies them verbatim and every lexicographic comparison is
  unchanged; Better Auth's own tables use the adapter's native types.
- Everything outside the Store speaks a portable query surface
  (`AppDatabase`) whose `?`-placeholder statements both engines answer
  identically, so settings, notifications, mail, and staff administration
  carry no dialect.
- The entire API-flow suite runs against either backend
  (`CHATBOT_TEST_POSTGRES_URL` selects Postgres, one database per file,
  freshly migrated): concurrency, email, disablement, reconnect, and
  retention proofs hold on both. The SQLite restart test is
  SQLite-specific by nature and skips on Postgres, where persistence across
  processes is the platform's own property.
- The SQLite→Postgres migration is repeatable (truncate-and-copy in one
  transaction), prints count and referential verification, and can revoke
  staff sessions at cutover so multifactor sign-in is re-established.
  Verified end to end against a real database: migrated password hashes
  verify, migrated TOTP secrets decrypt under the unchanged
  `BETTER_AUTH_SECRET`, and the migrated desk, history, and notifications
  answer over HTTP.
