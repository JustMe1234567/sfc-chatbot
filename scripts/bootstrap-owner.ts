// Trusted first-owner creation.
// Usage: npm run bootstrap:owner -- --username owner --password '…' [--name "College Owner"]
import { bootstrapOwner } from "../src/auth/bootstrapOwner";
import { appDatabaseUrl } from "../src/config";

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

const username = readFlag("username");
const password = readFlag("password");
const name = readFlag("name") ?? "College Owner";
const databaseUrl = appDatabaseUrl();

if (!username || !password || password.length < 10 || !databaseUrl) {
  console.error(
    "Usage: npm run bootstrap:owner -- --username <username> --password <10+ characters> [--name <name>] (DATABASE_URL is required)",
  );
  process.exit(1);
}

const owner = await bootstrapOwner({ username, password, name, databaseUrl });
console.log(`Owner account created: ${owner.username} (${owner.userId})`);
console.log(`Targeted store: ${owner.store}`);
console.log("The owner signs in with that username and password.");
