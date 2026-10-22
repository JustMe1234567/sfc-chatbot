import { getAuthTables } from "better-auth";
import { auth } from "./auth-schema-config";

const tables = getAuthTables(auth.options);
for (const [name, table] of Object.entries(tables)) {
  console.log(`table ${name}:`);
  for (const [field, def] of Object.entries(table.fields)) {
    console.log(
      `  ${field} type=${def.type} required=${def.required ?? false} unique=${def.unique ?? false} default=${JSON.stringify(def.defaultValue)}`,
    );
  }
}
