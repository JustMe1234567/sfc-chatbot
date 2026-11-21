// Trusted operator rename of a staff account's application username.
// Run only after the documented out-of-band identity check. The linked
// Supabase Auth user is never created, modified, or deleted; resetting the
// account's password is a separate operation (recover:staff).
// Usage: npm run rename:staff -- --from <current-username> --to <new-username> --identity-verified
import { renameStaffUsername } from "../src/auth/renameStaffUsername";
import { appDatabaseUrl } from "../src/config";

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const from = readFlag("from");
const to = readFlag("to");
const identityVerified = process.argv.includes("--identity-verified");
const databaseUrl = appDatabaseUrl();

if (!from || !to || !identityVerified || !databaseUrl) {
  console.error(
    "Usage: npm run rename:staff -- --from <current-username> --to <new-username> --identity-verified (DATABASE_URL is required)",
  );
  process.exit(1);
}

try {
  const result = await renameStaffUsername({
    currentUsername: from,
    newUsername: to,
    databaseUrl,
  });
  console.log(
    `Renamed "${result.from}" to "${result.to}" (staff account ${result.staffId}, updatedAt ${result.updatedAt}).`,
  );
  console.log(
    "The staff ID, linked Auth user, name, role, sessions, and all related records were preserved; no Auth user was created, modified, or deleted.",
  );
  console.log(
    `Password reset is a separate operation: npm run recover:staff -- --username ${result.to} --identity-verified (omit --password to enter it at a hidden prompt).`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
