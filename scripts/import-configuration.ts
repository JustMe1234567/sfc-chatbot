import { readFileSync } from "node:fs";
import { postgresAppDatabase } from "../src/db/appDatabase";
import { migratePostgres, openPostgres } from "../src/db/postgres";
import {
  importConfiguration,
  validateImportedConfiguration,
  type ConfigurationBundle,
} from "../src/configuration-transfer";

const targetUrl = process.env.CONFIG_TARGET_DATABASE_URL;
const bundlePath = process.env.CONFIG_BUNDLE_PATH;
if (!targetUrl || !bundlePath) {
  console.error("Set CONFIG_TARGET_DATABASE_URL and CONFIG_BUNDLE_PATH.");
  process.exit(1);
}

const bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as ConfigurationBundle;
const sql = openPostgres(targetUrl);
try {
  await migratePostgres(sql);
  const [authUsers] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM auth.users
  `;
  if ((authUsers?.count ?? 0) > 0) {
    throw new Error("Target is already in use: auth.users contains data.");
  }
  await sql.begin(async (transaction) => {
    const db = postgresAppDatabase(transaction as never);
    await importConfiguration(db, bundle);
    await validateImportedConfiguration(db, bundle);
  });
  console.log(
    `Imported and verified ${bundle.answerRules.length} answer rules and ${bundle.settings.length} settings.`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
