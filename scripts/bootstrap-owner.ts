// Server-side owner bootstrap: the only way the first owner account exists.
// It targets the store the running app would use, resolved with the app's
// own configuration (ticket 19): DATABASE_URL (or POSTGRES_URL) selects the
// Postgres store — applying the tracked migrations first, so a fresh
// project works — and without either, the local SQLite store, which the
// output says plainly.
// Usage: npm run bootstrap:owner -- --email owner@example.edu --password '…' [--name 'College Owner']
import { bootstrapOwner } from "../src/auth/bootstrapOwner";
import { appDatabaseUrl } from "../src/config";

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  return undefined;
}

const email = readFlag("email");
const password = readFlag("password");
const name = readFlag("name") ?? "College Owner";

if (!email || !password) {
  console.error("Usage: npm run bootstrap:owner -- --email <email> --password <password> [--name <name>]");
  process.exit(1);
}

const databaseUrl = appDatabaseUrl();
const owner = await bootstrapOwner({ email, password, name, databaseUrl });

const SIGN_IN_HINT =
  "The owner signs in at /dashboard/login with this password, is required to enroll an authenticator (TOTP), and signs in with it from then on.";

console.log(`Owner account ready: ${owner.email} (${owner.userId})`);
console.log(`Targeted store: ${owner.store}`);
if (databaseUrl) {
  console.log(`${SIGN_IN_HINT} Keep BETTER_AUTH_SECRET stable — rotating it invalidates enrolled TOTP secrets.`);
} else {
  console.log(
    `${SIGN_IN_HINT} This was the local SQLite development store: production must set DATABASE_URL and run this again against it. Set BETTER_AUTH_SECRET in the environment for anything beyond local development.`,
  );
}
process.exit(0);
