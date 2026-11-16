// Operator-assisted lost-authenticator recovery. Run only after the
// documented identity-verification procedure has been completed.
import { createClient } from "@supabase/supabase-js";
import { postgresAppDatabase } from "../src/db/appDatabase";
import { migratePostgres, openPostgres } from "../src/db/postgres";
import { appBaseUrl, appDatabaseUrl } from "../src/config";
import { supabaseConfiguration } from "../src/auth/supabase-provider";

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const email = readFlag("email")?.trim().toLowerCase();
const identityVerified = process.argv.includes("--identity-verified");
const databaseUrl = appDatabaseUrl();
if (!email || !identityVerified || !databaseUrl) {
  console.error(
    "Usage: npm run recover:staff -- --email <email> --identity-verified (DATABASE_URL is required)",
  );
  process.exit(1);
}

const configuration = supabaseConfiguration();
const admin = createClient(configuration.url, configuration.secretKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});
const publicClient = createClient(configuration.url, configuration.publishableKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});
const sql = openPostgres(databaseUrl);
try {
  await migratePostgres(sql);
  const db = postgresAppDatabase(sql);
  const member = await db.get<{ id: string; supabaseUserId: string | null; banned: boolean }>(
    `SELECT id, "supabaseUserId", banned FROM staff_members WHERE lower(email) = lower(?)`,
    email,
  );
  if (!member?.supabaseUserId || member.banned) {
    throw new Error("No active linked staff account exists for that email.");
  }

  const factors = await admin.auth.admin.mfa.listFactors({ userId: member.supabaseUserId });
  if (factors.error) throw factors.error;
  for (const factor of factors.data.factors) {
    const removed = await admin.auth.admin.mfa.deleteFactor({
      userId: member.supabaseUserId,
      id: factor.id,
    });
    if (removed.error) throw removed.error;
  }
  await db.run("DELETE FROM auth.sessions WHERE user_id = ?", member.supabaseUserId);
  await db.run(
    `UPDATE staff_members
     SET "twoFactorEnabled" = ?, "mfaRecoveryApprovedAt" = ?, "updatedAt" = ?
     WHERE id = ?`,
    false,
    new Date().toISOString(),
    new Date().toISOString(),
    member.id,
  );
  const recovery = await publicClient.auth.resetPasswordForEmail(email, {
    redirectTo: appBaseUrl(),
  });
  if (recovery.error) throw recovery.error;
  console.log(`Recovery email sent to ${email}. The operator approval expires in 30 minutes.`);
  console.log("All sessions and authenticator factors were revoked; a new factor is mandatory after reset.");
} finally {
  await sql.end({ timeout: 5 });
}
