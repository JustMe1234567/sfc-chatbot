-- Ticket 24: shared rate-limit counters that hold across serverless
-- instances. The abuse-facing create, return, and message limiters increment
-- one row per (scope, bucket, window) in the database the app already runs
-- on, so the limit survives instance recycling and no longer multiplies by
-- the number of deployed containers. SQLite mode keeps the in-memory limiter
-- and never touches this table; the maintenance pass prunes windows older
-- than the previous one.

CREATE TABLE rate_limit_hits (
  scope TEXT NOT NULL,
  bucket_key TEXT NOT NULL,
  window_start TEXT NOT NULL,
  hits INTEGER NOT NULL,
  PRIMARY KEY (scope, bucket_key, window_start)
);
