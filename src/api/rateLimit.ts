import { appDatabaseUrl } from "@/config";
import { getChatbotService } from "@/db/service";
import { createRateLimiter, envMs, RATE_WINDOW_MS } from "@/domain/limits";

export interface SharedRateLimiter {
  check(key: string, now?: number): Promise<boolean>;
}

/**
 * A rate limiter whose counters hold across serverless instances (ticket 24).
 *
 * On a database backend (DATABASE_URL set) every check upserts one
 * `rate_limit_hits` row per (scope, bucket key, window), so the budget is
 * shared by every deployed instance and survives function recycling — the
 * per-process multiplication of in-memory counters no longer applies. The
 * `scope` keeps each limiter's budget separate even where two of them key on
 * the same client. Windows are wall-clock aligned; the maintenance pass
 * prunes rows older than the previous window.
 *
 * SQLite mode (local development, the default test suite) keeps the plain
 * in-memory limiter — one process is the whole deployment there, and the
 * behavior contract (limit per window, per scope and key) is identical, which
 * is what the shared limiter's tests pin on both backends.
 */
export function createSharedRateLimiter(limit: number, scope: string): SharedRateLimiter {
  const inMemory = createRateLimiter(limit);
  return {
    async check(key: string, now = Date.now()): Promise<boolean> {
      if (!appDatabaseUrl()) {
        return inMemory.check(key, now);
      }
      const windowMs = envMs("RATE_WINDOW_MS", RATE_WINDOW_MS);
      const windowStart = new Date(now - (now % windowMs)).toISOString();
      const { db } = await getChatbotService();
      const row = await db.get<{ hits: number }>(
        `INSERT INTO rate_limit_hits (scope, bucket_key, window_start, hits)
         VALUES (?, ?, ?, 1)
         ON CONFLICT (scope, bucket_key, window_start)
         DO UPDATE SET hits = rate_limit_hits.hits + 1
         RETURNING hits`,
        scope,
        key,
        windowStart,
      );
      return (row?.hits ?? 1) <= limit;
    },
  };
}
