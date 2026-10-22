-- Staff authentication tables, generated from the installed better-auth 1.7
-- model definitions (user, session, account, verification, twoFactor) via
-- getAuthTables, plus the development mail outbox. Column names follow
-- better-auth's camelCase field names; date fields bind as ISO strings and
-- boolean/number fields bind as integers. The ticket 11 Postgres migration
-- maps these identifiers to a Postgres schema with proper types.

CREATE TABLE "user" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" INTEGER NOT NULL DEFAULT 0,
  "image" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "role" TEXT,
  "banned" INTEGER DEFAULT 0,
  "banReason" TEXT,
  "banExpires" TEXT,
  "twoFactorEnabled" INTEGER DEFAULT 0
);

CREATE TABLE "session" (
  "id" TEXT PRIMARY KEY,
  "expiresAt" TEXT NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES "user"("id"),
  "impersonatedBy" TEXT
);

CREATE INDEX idx_session_userId ON "session"("userId");

CREATE TABLE "account" (
  "id" TEXT PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"("id"),
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TEXT,
  "refreshTokenExpiresAt" TEXT,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX idx_account_userId ON "account"("userId");

CREATE TABLE "verification" (
  "id" TEXT PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE TABLE "twoFactor" (
  "id" TEXT PRIMARY KEY,
  "secret" TEXT NOT NULL,
  "backupCodes" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "user"("id"),
  "verified" INTEGER DEFAULT 1,
  "failedVerificationCount" INTEGER DEFAULT 0,
  "lockedUntil" TEXT
);

-- Development mail transport storage (see src/mail/outbox.ts).
CREATE TABLE mail_outbox (
  id TEXT PRIMARY KEY,
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
