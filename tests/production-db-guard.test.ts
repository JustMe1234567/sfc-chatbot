import { afterEach, describe, expect, it, vi } from "vitest";
import { assertConfiguredDatabaseUrl } from "../src/config";

/**
 * Ticket 22: production must refuse the silent SQLite fallback — the local
 * dev default cannot work on a serverless filesystem. The policy lives in
 * the pure env guard (src/config), tested here directly; the one
 * integration case proves getChatbotService actually applies it at the
 * fallback seam. Every other suite file is the standing proof that local
 * dev and the SQLite tests stay unaffected (they run with NODE_ENV=test).
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

/** No database URL configured, whatever the ambient shell environment has. */
function withoutDatabaseUrl(): void {
  // Unset, not blank: an empty DATABASE_URL would shadow the ?? fallback.
  vi.stubEnv("DATABASE_URL", undefined);
  vi.stubEnv("POSTGRES_URL", undefined);
}

describe("assertConfiguredDatabaseUrl (ticket 22)", () => {
  it("fails a production run without DATABASE_URL, naming the variable and the fix", () => {
    vi.stubEnv("NODE_ENV", "production");
    withoutDatabaseUrl();
    expect(() => assertConfiguredDatabaseUrl()).toThrowError(
      /DATABASE_URL.*docs\/deployment\.md/s,
    );
  });

  it("POSTGRES_URL alone satisfies production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", undefined);
    vi.stubEnv("POSTGRES_URL", "postgres://localhost:5432/sfc");
    expect(() => assertConfiguredDatabaseUrl()).not.toThrow();
  });

  it("an explicit CHATBOT_REQUIRE_DATABASE_URL=1 enforces the check outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CHATBOT_REQUIRE_DATABASE_URL", "1");
    withoutDatabaseUrl();
    expect(() => assertConfiguredDatabaseUrl()).toThrowError(
      /CHATBOT_REQUIRE_DATABASE_URL=1.*DATABASE_URL/s,
    );
  });

  it("the enforcement toggle is the exact value 1", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CHATBOT_REQUIRE_DATABASE_URL", "0");
    withoutDatabaseUrl();
    expect(() => assertConfiguredDatabaseUrl()).not.toThrow();
  });

  it("local development and the SQLite test suite keep their fallback", () => {
    // vitest runs with NODE_ENV=test; development spells it out.
    withoutDatabaseUrl();
    expect(() => assertConfiguredDatabaseUrl()).not.toThrow();
    vi.stubEnv("NODE_ENV", "development");
    expect(() => assertConfiguredDatabaseUrl()).not.toThrow();
  });

  // The service import pulls the whole auth+pg+kysely chain; under the
  // full PG suite's worker load that alone can exceed the default budget.
  it("getChatbotService refuses to build a service in production without a URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    withoutDatabaseUrl();
    const { getChatbotService } = await import("../src/db/service");
    await expect(getChatbotService()).rejects.toThrowError(
      /DATABASE_URL.*docs\/deployment\.md/s,
    );
  }, 120_000);
});
