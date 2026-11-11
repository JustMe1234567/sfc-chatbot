-- Postgres schema, part 1 of 3 (tickets 01-09): staff authentication and
-- the chat model. This mirrors migrations/0001-0007 on SQLite with the
-- ticket-12 desk columns and the ticket-14 successor link folded into the
-- conversations CREATE TABLE (see migrations/README.md for the full
-- mapping, the skipped 0009, and the intentional dialect differences).
--
-- Timestamps in the application's own tables are ISO-8601 UTC text, exactly
-- as the SQLite schema stores them: every comparison in the application is
-- lexicographic over these strings and the data migration copies them
-- verbatim. The authentication tables instead use the types Better Auth's
-- Postgres adapter expects (timestamptz, boolean) — the data migration
-- casts those columns.
--
-- seq columns (bigserial) replace SQLite's rowid as the monotonic tie-break
-- for same-timestamp ordering.

-- Better Auth: accounts, sessions, verification, TOTP second factor.
CREATE TABLE IF NOT EXISTS "user" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" BOOLEAN NOT NULL DEFAULT false,
  "image" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "role" TEXT,
  "banned" BOOLEAN DEFAULT false,
  "banReason" TEXT,
  "banExpires" TIMESTAMPTZ,
  "twoFactorEnabled" BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS "session" (
  "id" TEXT PRIMARY KEY,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "impersonatedBy" TEXT
);

CREATE INDEX IF NOT EXISTS idx_session_userId ON "session"("userId");

CREATE TABLE IF NOT EXISTS "account" (
  "id" TEXT PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TIMESTAMPTZ,
  "refreshTokenExpiresAt" TIMESTAMPTZ,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_userId ON "account"("userId");

CREATE TABLE IF NOT EXISTS "verification" (
  "id" TEXT PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "twoFactor" (
  "id" TEXT PRIMARY KEY,
  "secret" TEXT NOT NULL,
  "backupCodes" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "verified" BOOLEAN DEFAULT false,
  "failedVerificationCount" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMPTZ
);

-- Conversations and their transcript. The desk columns (last_activity_at is
-- the inactivity clock; attention_at the one-per-burst dashboard alert),
-- closed_at (the retention clock), and replaced_by (the ticket-14 successor
-- link, deliberately not a foreign key so retention purges conversations
-- independently) carry their final shape from the start.
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('bot_active', 'awaiting_staff', 'claimed', 'closed')),
  created_at TEXT NOT NULL,
  claimed_by TEXT REFERENCES "user"("id"),
  claimed_at TEXT,
  visitor_email TEXT,
  visitor_last_seen_at TEXT,
  closed_at TEXT,
  last_activity_at TEXT NOT NULL,
  attention_at TEXT,
  replaced_by TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('visitor', 'bot', 'staff')),
  text TEXT NOT NULL,
  link TEXT,
  created_at TEXT NOT NULL,
  choices TEXT,
  seq BIGSERIAL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, created_at);

-- Visitor credentials and mailed return links.
CREATE TABLE IF NOT EXISTS visitor_sessions (
  token_hash TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_visitor_sessions_conversation ON visitor_sessions (conversation_id);

CREATE TABLE IF NOT EXISTS return_tokens (
  token_hash TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_return_tokens_conversation ON return_tokens (conversation_id);

-- Approved answer rules.
CREATE TABLE IF NOT EXISTS answer_rules (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  response TEXT NOT NULL,
  link TEXT,
  phrases TEXT NOT NULL,
  keywords TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  updated_at TEXT NOT NULL,
  published_by TEXT,
  reviewed_at TEXT,
  seq BIGSERIAL
);

-- Key/value configuration: alert recipients, escalation phrases, support
-- hours, retention, analytics settings.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Escalation alert records and the local mail outbox (development and
-- diagnostics; production sends through the approved transactional sender).
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  recipients TEXT NOT NULL,
  delivered_to TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  -- The dedup key: one escalation alert and one visitor-return notification
  -- per conversation, ever. Retries reuse the row.
  UNIQUE (type, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications (status, created_at);

CREATE TABLE IF NOT EXISTS mail_outbox (
  id TEXT PRIMARY KEY,
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  seq BIGSERIAL
);
