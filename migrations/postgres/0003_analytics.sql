-- Postgres schema, part 3 of 3 (ticket 17): anonymous presence and daily
-- counting rollups. Mirrors migrations/0013 on SQLite.
--
-- analytics_seen: one row per anonymous browser per reporting day. The
-- visitor_hash is a SHA-256 of a random client-generated UUID — never an IP
-- address, email, chat credential, or message text. last_seen_at inside a
-- two-minute window decides "live"; day buckets use the reporting time zone.
--
-- analytics_daily: chats and escalations per reporting day. These rollups
-- are deliberately not connected to the conversations table: purging a
-- transcript must never change already-reported totals. Both tables expire
-- on the analytics retention period, independent of transcript retention.

CREATE TABLE IF NOT EXISTS analytics_seen (
  visitor_hash TEXT NOT NULL,
  day TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (visitor_hash, day)
);

CREATE INDEX IF NOT EXISTS analytics_seen_day_idx ON analytics_seen (day);
CREATE INDEX IF NOT EXISTS analytics_seen_last_seen_idx ON analytics_seen (last_seen_at);

CREATE TABLE IF NOT EXISTS analytics_daily (
  day TEXT PRIMARY KEY,
  chats INTEGER NOT NULL DEFAULT 0,
  escalations INTEGER NOT NULL DEFAULT 0
);
