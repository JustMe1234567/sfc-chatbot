-- Ticket 24: shared rate-limit counters that hold across serverless
-- instances (Postgres mirror of migrations/0016_rate_limit_hits.sql). The
-- abuse-facing create, return, and message limiters increment one row per
-- (scope, bucket, window) here, so the limit survives function recycling and
-- no longer multiplies by the number of deployed instances. The maintenance
-- pass prunes windows older than the previous one.

CREATE TABLE rate_limit_hits (
  scope TEXT NOT NULL,
  bucket_key TEXT NOT NULL,
  window_start TEXT NOT NULL,
  hits INTEGER NOT NULL,
  PRIMARY KEY (scope, bucket_key, window_start)
);
