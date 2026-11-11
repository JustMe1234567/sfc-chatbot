// Postgres-mode files must not multiply at the cluster's connection ceiling:
// two workers per pool keeps parallel provisioning inside max_connections.
process.env.PG_POOL_MAX = process.env.PG_POOL_MAX ?? "2";
process.env.PG_AUTH_POOL_MAX = process.env.PG_AUTH_POOL_MAX ?? "2";

import { beforeAll, describe, expect, it } from "vitest";
import { createSharedRateLimiter } from "../src/api/rateLimit";
import { pruneRateLimitWindows } from "../src/domain/limits";
import { countQuery, testPostgresUrl, useTempDatabase, warmChatbotService } from "./helpers";

beforeAll(async () => {
  useTempDatabase();
  // A short window makes boundary and reset tests deterministic without
  // real-time waits (except the one explicit window-roll sleep below).
  process.env.RATE_WINDOW_MS = "250";
  await warmChatbotService();
});

const describePostgresOnly = process.env.CHATBOT_TEST_POSTGRES_URL ? describe : describe.skip;

describe("shared rate-limit counters (ticket 24)", () => {
  it("enforces the limit within a window and restores it in the next", { timeout: 120_000 }, async () => {
    const limiter = createSharedRateLimiter(2, "shared-test-boundary");
    expect(await limiter.check("bucket", 1_000)).toBe(true);
    expect(await limiter.check("bucket", 1_001)).toBe(true);
    expect(await limiter.check("bucket", 1_002)).toBe(false);
    // The next window starts a fresh budget (wall-clock-aligned windows).
    expect(await limiter.check("bucket", 1_000 + 250)).toBe(true);
  });

  it("keeps buckets independent per scope and per key", { timeout: 120_000 }, async () => {
    const scopeA = createSharedRateLimiter(1, "shared-test-scope-a");
    const scopeB = createSharedRateLimiter(1, "shared-test-scope-b");
    expect(await scopeA.check("bucket", 2_000)).toBe(true);
    expect(await scopeA.check("bucket", 2_001)).toBe(false);
    // Same key under a different limiter's scope: its own budget.
    expect(await scopeB.check("bucket", 2_002)).toBe(true);
    // Same scope, different key: its own budget.
    expect(await scopeA.check("other-bucket", 2_003)).toBe(true);
  });

  it("prunes only windows older than the previous one", { timeout: 120_000 }, async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { db } = await getChatbotService();
    const insert = countQuery(
      "INSERT INTO rate_limit_hits (scope, bucket_key, window_start, hits) VALUES ($1, $2, $3, $4)",
      "INSERT INTO rate_limit_hits (scope, bucket_key, window_start, hits) VALUES (?, ?, ?, ?)",
    );
    // A fixed reference now makes the cutoff deterministic regardless of
    // machine load: ancient (far before now - 2 windows) must go, while the
    // previous and current windows survive.
    const now = Date.now();
    await db.run(insert, "shared-test-prune", "old", "2026-01-01T00:00:00.000Z", 7);
    await db.run(insert, "shared-test-prune", "fresh", new Date(now - 100).toISOString(), 3);
    await db.run(insert, "shared-test-prune", "current", new Date(now + 600_000).toISOString(), 1);

    const removed = await pruneRateLimitWindows(db, now);
    expect(removed).toBeGreaterThanOrEqual(1);

    const select = countQuery(
      "SELECT bucket_key FROM rate_limit_hits WHERE scope = $1 ORDER BY bucket_key",
      "SELECT bucket_key FROM rate_limit_hits WHERE scope = ? ORDER BY bucket_key",
    );
    const survivors = (await db.all<{ bucket_key: string }>(select, "shared-test-prune")).map(
      (row) => row.bucket_key,
    );
    expect(survivors).toEqual(["current", "fresh"]);
  });
});

describePostgresOnly("shared counters across limiter instances (ticket 24)", () => {
  // On Postgres the counters live in the shared table, so two independent
  // factory instances — as two serverless instances would construct — see
  // one budget. On SQLite the fallback is per-process in-memory, which is
  // exactly why this block is Postgres-only.
  it("one instance's hits count against another's budget", { timeout: 120_000 }, async () => {
    const first = createSharedRateLimiter(1, "shared-test-instances");
    const second = createSharedRateLimiter(1, "shared-test-instances");
    expect(await first.check("bucket", 5_000)).toBe(true);
    expect(await second.check("bucket", 5_001)).toBe(false);
  });

  it("a spent bucket recovers when the window rolls", { timeout: 120_000 }, async () => {
    const limiter = createSharedRateLimiter(1, "shared-test-window-roll");
    // Explicit nows keep this off the real clock: 9000 and 9100 share the
    // [9000, 9250) window, 9260 starts the next one.
    expect(await limiter.check("bucket", 9_000)).toBe(true);
    expect(await limiter.check("bucket", 9_100)).toBe(false);
    expect(await limiter.check("bucket", 9_260)).toBe(true);
  });
});
