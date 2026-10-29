import { DatabaseSync } from "node:sqlite";
import { sqliteAppDatabase } from "../src/db/appDatabase";
import { NodeSqliteDialect } from "@better-auth/kysely-adapter/node-sqlite-dialect";
import { createAuth } from "../src/auth/server";
import { createOutboxTransport } from "../src/mail/outbox";

// CLI-only config: the schema generator reads options; nothing connects.
const db = new DatabaseSync(":memory:");
const mailDb = new DatabaseSync(":memory:");
export const auth = createAuth({
  db: sqliteAppDatabase(db),
  dialect: new NodeSqliteDialect({ database: db }),
  kyselyType: "sqlite",
  mail: createOutboxTransport(sqliteAppDatabase(mailDb)),
  baseUrl: process.env.CHATBOT_BASE_URL ?? "http://localhost:3000",
});

export default auth;
