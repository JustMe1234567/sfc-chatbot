-- Ticket 17: lightweight visitor and chat analytics.
--
-- analytics_seen: one row per anonymous browser per reporting day. The
-- visitor_hash is a SHA-256 of a random client-generated UUID — never an IP
-- address, email, chat credential, or message text. last_seen_at inside a
-- two-minute window decides "live"; the day column buckets reporting days in
-- the site's reporting time zone.
--
-- analytics_daily: counting rollups for chats and escalations, keyed by
-- reporting day. Rows are incremented by the request paths that create a
-- conversation or escalate one, and are deliberately not connected to the
-- conversations table: purging a transcript (ticket 10) must never change
-- already-reported totals. Both tables expire on the analytics retention
-- period, independent of transcript retention.
CREATE TABLE analytics_seen (
  visitor_hash TEXT NOT NULL,
  day TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (visitor_hash, day)
);

CREATE INDEX analytics_seen_day_idx ON analytics_seen (day);
CREATE INDEX analytics_seen_last_seen_idx ON analytics_seen (last_seen_at);

CREATE TABLE analytics_daily (
  day TEXT PRIMARY KEY,
  chats INTEGER NOT NULL DEFAULT 0,
  escalations INTEGER NOT NULL DEFAULT 0
);
