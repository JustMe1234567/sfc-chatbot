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

/**
 * Postgres connection string (Supabase in production, a local cluster for
 * development and tests). When set, it takes precedence over CHATBOT_DB:
 * the application runs entirely on Postgres (ticket 11).
 */
export function appDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  return url && url.trim().length > 0 ? url.trim() : null;
}

/**
 * Guards the store selection (ticket 22): without a configured URL the app
 * silently falls back to the local SQLite file, which cannot work on
 * Vercel's read-only filesystem. Production runs — or any deployment that
 * sets CHATBOT_REQUIRE_DATABASE_URL=1 — must name DATABASE_URL, or startup
 * fails with the fix instead of a confusing filesystem error.
 */
export function assertConfiguredDatabaseUrl(): void {
  if (appDatabaseUrl()) {
    return;
  }
  const forced = process.env.CHATBOT_REQUIRE_DATABASE_URL === "1";
  if (process.env.NODE_ENV !== "production" && !forced) {
    return;
  }
  throw new Error(
    "No DATABASE_URL (or POSTGRES_URL) is configured for this production run" +
      (forced ? " (CHATBOT_REQUIRE_DATABASE_URL=1)" : "") +
      "; the app would fall back to the local SQLite file, which cannot work " +
      "on the server's read-only filesystem. Set DATABASE_URL per " +
      "docs/deployment.md.",
  );
}
