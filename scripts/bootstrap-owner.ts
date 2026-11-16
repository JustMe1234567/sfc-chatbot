// Trusted first-owner invitation. Secrets come from environment variables;
// the command accepts only the owner's identity.
// Usage: npm run bootstrap:owner -- --email owner@example.edu [--name "College Owner"]
import { bootstrapOwner } from "../src/auth/bootstrapOwner";
import { appDatabaseUrl } from "../src/config";

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

const email = readFlag("email");
const name = readFlag("name") ?? "College Owner";
const databaseUrl = appDatabaseUrl();

if (!email || !databaseUrl) {
  console.error(
    "Usage: npm run bootstrap:owner -- --email <email> [--name <name>] (DATABASE_URL is required)",
  );
  process.exit(1);
}

const owner = await bootstrapOwner({ email, name, databaseUrl });
console.log(`Owner invitation sent: ${owner.email} (${owner.userId})`);
console.log(`Targeted store: ${owner.store}`);
console.log("The owner sets a password from the email link, then enrolls an authenticator.");
