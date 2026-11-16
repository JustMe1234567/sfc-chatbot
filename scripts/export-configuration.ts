import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { sqliteAppDatabase, postgresAppDatabase } from "../src/db/appDatabase";
import { openPostgres } from "../src/db/postgres";
import { exportConfiguration } from "../src/configuration-transfer";

const output = process.env.CONFIG_BUNDLE_PATH;
const postgresUrl = process.env.CONFIG_SOURCE_DATABASE_URL;
const sqlitePath = process.env.CONFIG_SOURCE_SQLITE_PATH;

if (!output || (!postgresUrl && !sqlitePath) || (postgresUrl && sqlitePath)) {
  console.error(
    "Set CONFIG_BUNDLE_PATH and exactly one of CONFIG_SOURCE_DATABASE_URL or CONFIG_SOURCE_SQLITE_PATH.",
  );
  process.exit(1);
}

const bundle = postgresUrl
  ? await (async () => {
      const sql = openPostgres(postgresUrl);
      try {
        return await exportConfiguration(postgresAppDatabase(sql));
      } finally {
        await sql.end({ timeout: 5 });
      }
    })()
  : await (async () => {
      const raw = new DatabaseSync(sqlitePath!, { readOnly: true });
      try {
        return await exportConfiguration(sqliteAppDatabase(raw));
      } finally {
        raw.close();
      }
    })();

writeFileSync(output, `${JSON.stringify(bundle, null, 2)}\n`, { flag: "wx" });
console.log(`Exported ${bundle.answerRules.length} answer rules and ${bundle.settings.length} settings to ${output}.`);
