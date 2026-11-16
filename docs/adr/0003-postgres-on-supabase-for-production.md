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
  tie-break. Application timestamps remain ISO-8601 UTC text, so configuration
  transfer copies them verbatim and every lexicographic comparison is unchanged.
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
- The later Supabase Auth decision (ADR-0004) keeps this Postgres choice but
  replaces full-database cutover with configuration-only transfer into a fresh
  target. Staff credentials, sessions, conversations, and history are not copied.
