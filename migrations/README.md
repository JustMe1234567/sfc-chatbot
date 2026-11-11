# Migrations

Two independent sequences live here: `NNNN_*.sql` for SQLite (local
development) and `postgres/NNNN_*.sql` for Postgres (production,
Supabase). Each sequence is tracked in its database's `_migrations` table
and applied in numeric order; new migrations take the next number in their
sequence, and every Postgres migration mirrors its SQLite counterpart's
ticket.

## The numbering does not line up across the sequences — that is expected

The Postgres schema was written in one pass (ticket 11, commit 76b9e3c)
after the SQLite sequence had already reached 0013, so `postgres/0001`
folds the chat model plus later `ALTER TABLE` work into a single
`CREATE TABLE`, and `postgres/0002` gathers two unrelated SQLite files'
tables. Where each piece physically lives:

| Ticket | SQLite | Postgres (physical DDL location) |
| --- | --- | --- |
| 01-07 chat + auth model | 0001-0007 | 0001 |
| 08 audit trail | 0008 | 0002 (`audit_log`) |
| 10 transcript retention | 0010 | 0002 (`retention_runs`) |
| 12 conversation desk | 0011 | 0001 (desk columns in `CREATE TABLE`) |
| 14 clear conversation | 0012 | 0001 (`replaced_by` in `CREATE TABLE`) |
| 17 analytics | 0013 | 0003 |
| 58 answer rule lifecycle | 0014 | 0004 |
| 66 visitor contact | 0015 | 0005 |
| 24 shared rate limits | 0016 | 0006 |

## Why SQLite skips 0009

No file named `0009` was ever committed. Ticket 09 (configured support
hours) needed no schema change — its data lives in the `settings` table
from `0003_settings_and_notifications.sql` — and the next schema change,
ticket 10's retention sweep, was committed directly as `0010`. The gap is
historical: do not renumber existing files and do not reuse the number.

## The dialects' defaults differ slightly — that is expected too

`twoFactor` reads slightly differently in the two schemas (SQLite
`0002_auth_and_mail.sql` vs `postgres/0001_auth_and_chat.sql`): SQLite has
`backupCodes NOT NULL` / `verified INTEGER DEFAULT 1` / nullable
`failedVerificationCount`; Postgres has nullable `backupCodes` /
`verified BOOLEAN DEFAULT false` / `failedVerificationCount NOT NULL
DEFAULT 0`. The differences are harmless — Better Auth treats the columns
the same way, and `scripts/migrate-sqlite-to-postgres.ts` copies values
verbatim — so the schemas are intentionally not realigned; realigning
SQLite would cost a table rebuild for zero behavioral gain.
