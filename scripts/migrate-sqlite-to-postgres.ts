// SQLite -> Postgres data migration (ticket 11).
//
//   npx tsx scripts/migrate-sqlite-to-postgres.ts --url "$DATABASE_URL" [--sqlite chatbot.db] [--revoke-sessions]
//
// Repeatable: the target tables are truncated inside the same transaction
// that copies, so a rerun converges to the source instead of duplicating.
// Identifiers, timestamps (the app's own ISO-8601 text columns), and JSON
// payloads are copied verbatim; Better Auth's flag and date columns are cast
// to the Postgres types its adapter expects (boolean, timestamptz).
//
// After it runs, the printed verification section must show equal counts and
// PASS on every referential spot check before any traffic switches.
import { DatabaseSync } from "node:sqlite";
import { appDbPath } from "../src/config";
import { migratePostgres, withPostgres, type PostgresSql } from "../src/db/postgres";

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  return undefined;
}

const sqlitePath = readFlag("sqlite") ?? appDbPath();
const targetUrl = readFlag("url") ?? process.env.DATABASE_URL;
const revokeSessions = process.argv.includes("--revoke-sessions");

if (!targetUrl) {
  console.error("Provide the Postgres target: --url postgres://... (or set DATABASE_URL).");
  process.exit(1);
}

const source = new DatabaseSync(sqlitePath, { readOnly: true });

/**
 * Every table in copy order: parents before children. JSON.stringify is the
 * identifier quoting below — a JS string becomes a double-quoted SQL
 * identifier (the "user" table needs the quotes); table and column names
 * are this file's own constants, never input.
 */
const TABLES = [
  "user",
  "session",
  "account",
  "verification",
  "twoFactor",
  "conversations",
  "messages",
  "visitor_sessions",
  "return_tokens",
  "answer_rules",
  "settings",
  "notifications",
  "mail_outbox",
  "audit_log",
  "retention_runs",
  "analytics_seen",
  "analytics_daily",
  "contact_requests",
] as const;

/** Better Auth columns that are INTEGER 0/1 on SQLite and boolean on Postgres. */
const BOOLEAN_COLUMNS: Record<string, string[]> = {
  user: ["emailVerified", "banned", "twoFactorEnabled"],
  twoFactor: ["verified"],
};

/** Better Auth columns that are ISO text on SQLite and timestamptz on Postgres. */
const TIMESTAMP_COLUMNS: Record<string, string[]> = {
  user: ["createdAt", "updatedAt", "banExpires"],
  session: ["expiresAt", "createdAt", "updatedAt"],
  account: ["accessTokenExpiresAt", "refreshTokenExpiresAt", "createdAt", "updatedAt"],
  verification: ["expiresAt", "createdAt", "updatedAt"],
  twoFactor: ["lockedUntil"],
};

function columnsOf(table: string): string[] {
  return (source.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all() as {
    name: string;
  }[]).map((column) => column.name);
}

function convertValue(table: string, column: string, value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if ((BOOLEAN_COLUMNS[table] ?? []).includes(column)) {
    // SQLite stores 0/1; verification rows may also carry booleans already.
    return value === 1 || value === true;
  }
  if ((TIMESTAMP_COLUMNS[table] ?? []).includes(column)) {
    return new Date(String(value)); // postgres.js binds Date as timestamptz
  }
  return value;
}

async function copyTable(sql: { unsafe(query: string, params?: unknown[]): Promise<any> }, table: string): Promise<number> {
  const columns = columnsOf(table);
  const rows = source
    .prepare(`SELECT ${columns.map((c) => JSON.stringify(c)).join(", ")} FROM ${JSON.stringify(table)}`)
    .all() as Record<string, unknown>[];
  for (const row of rows) {
    const values = columns.map((column) => convertValue(table, column, row[column]));
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    await sql.unsafe(
      `INSERT INTO ${JSON.stringify(table)} (${columns.map((c) => JSON.stringify(c)).join(", ")})
       VALUES (${placeholders})`,
      values,
    );
  }
  return rows.length;
}

console.log(`Migrating ${sqlitePath} -> ${targetUrl.replace(/:[^:@/]+@/, ":***@")}`);
if (revokeSessions) {
  console.log("Staff sessions will be revoked (cutover requires fresh sign-in + second factor).");
}

await withPostgres(targetUrl, async (sql) => {
  await migratePostgres(sql);

  await sql.begin(async (tx) => {
    // Repeatable by construction: the copy converges the target to the source.
    await tx.unsafe(`TRUNCATE TABLE ${TABLES.map((t) => JSON.stringify(t)).join(", ")} CASCADE`);

    for (const table of TABLES) {
      if (table === "session" && revokeSessions) {
        continue;
      }
      await copyTable(tx, table);
    }
  });

  // ---- Verification: counts plus referential spot checks. ----------------
  console.log("\n=== Row counts (SQLite -> Postgres) ===");
  let verified = true;
  for (const table of TABLES) {
    const sourceCount = (
      source.prepare(`SELECT COUNT(*) AS n FROM ${JSON.stringify(table)}`).get() as { n: number }
    ).n;
    const expected = table === "session" && revokeSessions ? 0 : sourceCount;
    const targetCount = Number(
      ((await sql.unsafe(`SELECT COUNT(*) AS n FROM ${JSON.stringify(table)}`)) as unknown as {
        n: number | string;
      }[])[0]?.n,
    );
    const ok = targetCount === expected;
    verified = verified && ok;
    console.log(
      `${ok ? "PASS" : "FAIL"} ${table}: ${sourceCount} -> ${targetCount}${table === "session" && revokeSessions ? " (revoked)" : ""}${ok ? "" : ` — expected ${expected}`}`,
    );
  }

  const spotChecks: { name: string; sql: string }[] = [
    {
      name: "every message belongs to a conversation",
      sql: "SELECT COUNT(*) AS n FROM messages m LEFT JOIN conversations c ON c.id = m.conversation_id WHERE c.id IS NULL",
    },
    {
      name: "every session belongs to a user",
      sql: 'SELECT COUNT(*) AS n FROM "session" s LEFT JOIN "user" u ON u.id = s."userId" WHERE u.id IS NULL',
    },
    {
      name: "every visitor session belongs to a conversation",
      sql: "SELECT COUNT(*) AS n FROM visitor_sessions v LEFT JOIN conversations c ON c.id = v.conversation_id WHERE c.id IS NULL",
    },
    {
      name: "every audit entry's actor exists",
      sql: 'SELECT COUNT(*) AS n FROM audit_log a LEFT JOIN "user" u ON u.id = a.actor_id WHERE a.actor_id IS NOT NULL AND u.id IS NULL',
    },
  ];
  console.log("\n=== Referential spot checks ===");
  for (const check of spotChecks) {
    const orphans = Number(((await sql.unsafe(check.sql)) as unknown as { n: number | string }[])[0]?.n);
    const ok = orphans === 0;
    verified = verified && ok;
    console.log(`${ok ? "PASS" : "FAIL"} ${check.name}${ok ? "" : ` — ${orphans} orphans`}`);
  }

  const twoFactor = Number(
    ((await sql.unsafe('SELECT COUNT(*) AS n FROM "twoFactor"')) as unknown as { n: number | string }[])[0]?.n,
  );
  console.log("\n=== Cutover notes ===");
  console.log(
    twoFactor > 0
      ? `TOTP secrets migrated for ${twoFactor} account(s): sign-in works with existing authenticator apps while BETTER_AUTH_SECRET stays unchanged.`
      : "No TOTP enrollments migrated; staff enroll a second factor at first sign-in.",
  );
  if (!revokeSessions) {
    console.log("Rerun with --revoke-sessions at cutover so staff sign in again with multifactor authentication.");
  }
  console.log(
    verified
      ? "\nVERIFICATION PASSED. Safe to point traffic at this database after the owner's own count review."
      : "\nVERIFICATION FAILED. Do not switch traffic; investigate the FAIL lines above.",
  );
  if (!verified) {
    process.exitCode = 1;
  }
});

source.close();
