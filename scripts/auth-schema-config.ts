import { DatabaseSync } from "node:sqlite";
import { createAuth } from "../src/auth/server";
import { createOutboxTransport } from "../src/mail/outbox";

// CLI-only config: the schema generator reads options; nothing connects.
export const auth = createAuth({
  db: new DatabaseSync(":memory:"),
  mail: createOutboxTransport(new DatabaseSync(":memory:")),
  baseUrl: process.env.CHATBOT_BASE_URL ?? "http://localhost:3000",
});

export default auth;
