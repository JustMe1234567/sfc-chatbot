import path from "node:path";
import { repoRoot } from "./paths";

/** Public origin of the chatbot app (API base for staff mail links and CORS trust). */
export function appBaseUrl(): string {
  return process.env.CHATBOT_BASE_URL ?? "http://localhost:3000";
}

/**
 * Origins allowed to make cookie-authenticated state-changing requests.
 * Production trusts exactly the configured public origin; local development
 * additionally trusts both loopback spellings, which browsers treat as
 * different origins.
 */
export function trustedOrigins(): string[] {
  const base = appBaseUrl();
  if (process.env.NODE_ENV === "production") {
    return [base];
  }
  return [...new Set([base, "http://localhost:3000", "http://127.0.0.1:3000"])];
}

/** SQLite database file backing chat data and staff authentication. */
export function appDbPath(): string {
  return process.env.CHATBOT_DB ?? path.join(repoRoot(), "chatbot.db");
}
