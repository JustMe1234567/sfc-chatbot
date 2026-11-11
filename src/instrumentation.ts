/**
 * Server startup hook (ticket 22): a production boot without DATABASE_URL
 * fails here, before the server is ready to serve anything — the same
 * guard getChatbotService applies at its SQLite fallback seam, moved
 * earlier so the deployment sees the configuration error at startup.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  // Dynamic import per the convention docs: the guard's import chain uses
  // node builtins the edge runtime must never bundle.
  const { assertConfiguredDatabaseUrl } = await import("./config");
  assertConfiguredDatabaseUrl();
}
