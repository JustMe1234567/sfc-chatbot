// Trusted credential recovery for an account whose owner cannot use the dashboard.
// Run only after the documented out-of-band identity check.
import { createSupabaseAuth } from "../src/auth/supabase-provider";
import { postgresAppDatabase } from "../src/db/appDatabase";
import { migratePostgres, openPostgres } from "../src/db/postgres";
import { appBaseUrl, appDatabaseUrl } from "../src/config";

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const username = readFlag("username")?.trim().toLowerCase();
const password = readFlag("password");
const identityVerified = process.argv.includes("--identity-verified");
const databaseUrl = appDatabaseUrl();

if (
  !username ||
  !/^[a-z0-9._-]{3,32}$/.test(username) ||
  !password ||
  password.length < 10 ||
  !identityVerified ||
  !databaseUrl
) {
  console.error(
    "Usage: npm run recover:staff -- --username <username> --password <10+ characters> --identity-verified (DATABASE_URL is required)",
  );
  process.exit(1);
}

const sql = openPostgres(databaseUrl);
try {
  await migratePostgres(sql);
  const db = postgresAppDatabase(sql);
  const member = await db.get<{
    id: string;
    supabaseUserId: string | null;
    banned: unknown;
  }>(
    `SELECT "id", "supabaseUserId", "banned"
     FROM staff_members WHERE lower("username") = lower(?)`,
    username,
  );
  if (!member?.supabaseUserId || member.banned === true || member.banned === 1) {
    throw new Error("No active linked staff account exists for that username.");
  }

  const auth = createSupabaseAuth({ db, baseUrl: appBaseUrl() });
  await auth.resetPassword(member.supabaseUserId, password);

  console.log(`Credentials reset for ${username}. All existing sessions were revoked.`);
} finally {
  await sql.end({ timeout: 5 });
}
