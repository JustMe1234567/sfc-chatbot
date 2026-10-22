import path from "node:path";
import { repoRoot } from "./paths";

/** Public origin of the chatbot app (API base for staff mail links and CORS trust). */
export function appBaseUrl(): string {
  return process.env.CHATBOT_BASE_URL ?? "http://localhost:3000";
}

/** SQLite database file backing chat data and staff authentication. */
export function appDbPath(): string {
  return process.env.CHATBOT_DB ?? path.join(repoRoot(), "chatbot.db");
}
