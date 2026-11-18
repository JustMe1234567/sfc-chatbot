-- Ticket 81: observable dashboard sign-ins (Postgres mirror of
-- migrations/0021_login_events.sql). Every credential attempt at the auth
-- provider's sign-in path lands in login_events — attempted username,
-- outcome, failure reason, client IP, user agent, and time — with the
-- suspicious patterns (ticket 81 criteria a-c) evaluated as each event is
-- written for the owner-only Logs tab. Hammering that names no live staff
-- account earns a temporary IP block, held in login_ip_blocks: the tenth
-- non-staff-username failure from one IP within a rolling ten minutes
-- rejects that IP's non-staff-username attempts for one hour, with no
-- manual release. The block lives in its own table so clearing the log can
-- never release a block early — auto-expiry is the only release.

CREATE TABLE login_events (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'blocked')),
  reason TEXT NOT NULL,
  ip TEXT NOT NULL,
  user_agent TEXT,
  username_known INTEGER NOT NULL CHECK (username_known IN (0, 1)),
  suspicious INTEGER NOT NULL CHECK (suspicious IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_login_events_created ON login_events(created_at);
CREATE INDEX idx_login_events_username_ip ON login_events(username, ip);
CREATE INDEX idx_login_events_ip_time ON login_events(ip, created_at);

CREATE TABLE login_ip_blocks (
  ip TEXT PRIMARY KEY,
  blocked_until TEXT NOT NULL,
  created_at TEXT NOT NULL
);
