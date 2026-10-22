// Server-side owner bootstrap: the only way the first owner account exists.
// Usage: npm run bootstrap:owner -- --email owner@example.edu --password '…' [--name 'College Owner']
import { openDatabase } from "../src/db/sqlite";
import { createAuth } from "../src/auth/server";
import { createOutboxTransport } from "../src/mail/outbox";
import { provisionStaffMember } from "../src/auth/provision";
import { appBaseUrl, appDbPath } from "../src/config";

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

const db = openDatabase(appDbPath());
const auth = createAuth({
  db,
  mail: createOutboxTransport(db),
  baseUrl: appBaseUrl(),
});

const owner = await provisionStaffMember(auth, db, {
  email,
  password,
  name,
  role: "owner",
});

console.log(`Owner account ready: ${owner.email} (${owner.userId})`);
console.log(
  "The owner signs in at /dashboard/login with this password, is required to enroll an authenticator (TOTP), and signs in with it from then on. Set BETTER_AUTH_SECRET and CHATBOT_DB in the environment for anything beyond local development.",
);
process.exit(0);
