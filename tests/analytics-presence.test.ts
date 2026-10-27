import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { useTempDatabase, TEST_ORIGIN, warmChatbotService } from "./helpers";

/**
 * The anonymous presence heartbeat (ticket 17): a credential-free public
 * endpoint that counts browsers, never people. No IP address, email, or chat
 * identity may reach the analytics tables; the browser-supplied random id is
 * stored only as a SHA-256 hash.
 */

function presenceRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${TEST_ORIGIN}/api/v1/presence`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Browsers always attach Origin to a POST, and the app's CSRF guard
      // requires it to be a trusted origin — same as every other route.
      origin: TEST_ORIGIN,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function postPresence(
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  const { POST } = await import("../src/app/api/v1/presence/route");
  return POST(presenceRequest(body, headers));
}

async function storedPresence(): Promise<
  { visitor_hash: string; day: string; first_seen_at: string; last_seen_at: string }[]
> {
  const { getChatbotService } = await import("../src/db/service");
  const { db } = await getChatbotService();
  return db
    .prepare(
      "SELECT visitor_hash, day, first_seen_at, last_seen_at FROM analytics_seen ORDER BY visitor_hash",
    )
    .all() as unknown as {
    visitor_hash: string;
    day: string;
    first_seen_at: string;
    last_seen_at: string;
  }[];
}

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await warmChatbotService();
});

describe("presence heartbeat request handling", () => {
  it("accepts a well-formed browser id and reports the analytics retention period", async () => {
    const response = await postPresence({ browserId: crypto.randomUUID() });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { retentionDays: number };
    expect(body.retentionDays).toBe(90);
  });

  it("rejects bodies without a UUID-shaped browser id", async () => {
    expect((await postPresence({})).status).toBe(400);
    expect((await postPresence({ browserId: 42 })).status).toBe(400);
    expect((await postPresence({ browserId: "not-a-uuid" })).status).toBe(400);
    expect((await postPresence({ browserId: `${crypto.randomUUID()}/../etc` })).status).toBe(400);
  });

  it("blocks requests without a trusted Origin as well as untrusted ones", async () => {
    const response = await postPresence(
      { browserId: crypto.randomUUID() },
      { origin: "https://evil.example" },
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("cross_origin_blocked");
    const absent = new Request(`${TEST_ORIGIN}/api/v1/presence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ browserId: crypto.randomUUID() }),
    });
    const { POST } = await import("../src/app/api/v1/presence/route");
    expect((await POST(absent)).status).toBe(403);
  });

  it("stores only a SHA-256 hash of the id, never the id or any IP address", async () => {
    const browserId = crypto.randomUUID();
    const response = await postPresence({ browserId });
    expect(response.ok).toBe(true);
    const rows = await storedPresence();
    const expected = createHash("sha256").update(browserId).digest("hex");
    const mine = rows.filter((row) => row.visitor_hash === expected);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.visitor_hash).not.toBe(browserId);
    // The analytics schema has nowhere an address could land: presence rows
    // carry the hashed id, the reporting day, and the two instants only.
    const { getChatbotService } = await import("../src/db/service");
    const { db } = await getChatbotService();
    const columns = (
      db.prepare("PRAGMA table_info(analytics_seen)").all() as unknown as { name: string }[]
    ).map((column) => column.name);
    expect(columns).toEqual(["visitor_hash", "day", "first_seen_at", "last_seen_at"]);
  });

  it("keeps one browser one row per day no matter how many beats arrive", async () => {
    const browserId = crypto.randomUUID();
    for (let beat = 0; beat < 4; beat += 1) {
      const response = await postPresence({ browserId });
      expect(response.ok).toBe(true);
    }
    const rows = await storedPresence();
    const expected = createHash("sha256").update(browserId).digest("hex");
    expect(rows.filter((row) => row.visitor_hash === expected)).toHaveLength(1);
  });

  it("rate limits heartbeat floods per client and stores nothing for rejected beats", async () => {
    const { PRESENCE_RATE_LIMIT } = await import("../src/domain/limits");
    const ip = "10.77.7.7";
    const before = (await storedPresence()).length;
    let lastStatus = 0;
    for (let sent = 0; sent <= PRESENCE_RATE_LIMIT; sent += 1) {
      const response = await postPresence(
        { browserId: crypto.randomUUID() },
        { "x-forwarded-for": ip },
      );
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
    const after = (await storedPresence()).length;
    expect(after - before).toBeLessThanOrEqual(PRESENCE_RATE_LIMIT);
  });
});

describe("live-visitor window", () => {
  it("counts a browser live for two minutes after its last beat, then not", async () => {
    const { store } = await (await import("../src/db/service")).getChatbotService();
    const { buildAnalyticsReport } = await import("../src/domain/analytics");
    const { hashSessionToken } = await import("../src/domain/tokens");

    const now = Date.now();
    const options = {
      timeZone: "UTC",
      retentionDays: 90,
      period: "today" as const,
      now: new Date(now),
    };
    // The file's database already holds beats from earlier tests; measure
    // against that baseline so this test owns only its own two browsers.
    const baseline = await buildAnalyticsReport(store, options);

    const freshAt = new Date(now - 1000);
    const staleAt = new Date(now - 3 * 60 * 1000);
    await store.recordAnalyticsPresence(
      hashSessionToken(crypto.randomUUID()),
      freshAt.toISOString(),
      freshAt.toISOString().slice(0, 10),
    );
    await store.recordAnalyticsPresence(
      hashSessionToken(crypto.randomUUID()),
      staleAt.toISOString(),
      staleAt.toISOString().slice(0, 10),
    );

    const report = await buildAnalyticsReport(store, options);
    // Only the fresh browser is live: the stale one's beat is outside the
    // two-minute window, though still today.
    expect(report.totals.liveVisitors).toBe(baseline.totals.liveVisitors + 1);
    // Both browsers count as visitors of the period their beats fell in —
    // only the two-minute window decides liveness.
    expect(report.totals.visitors).toBe(baseline.totals.visitors + 2);
  });

  it("counts a browser beating either side of local midnight once, not twice", async () => {
    const { store } = await (await import("../src/db/service")).getChatbotService();
    const { buildAnalyticsReport } = await import("../src/domain/analytics");
    const { hashSessionToken } = await import("../src/domain/tokens");

    const now = Date.now();
    const options = {
      timeZone: "UTC",
      retentionDays: 90,
      period: "today" as const,
      now: new Date(now),
    };
    const baseline = await buildAnalyticsReport(store, options);
    const hash = hashSessionToken(crypto.randomUUID());
    // The same browser holds a row for yesterday's day bucket and today's,
    // both beats well inside the live window.
    await store.recordAnalyticsPresence(
      hash,
      new Date(now - 30 * 1000).toISOString(),
      "2026-01-01",
    );
    await store.recordAnalyticsPresence(
      hash,
      new Date(now - 10 * 1000).toISOString(),
      "2026-01-02",
    );

    const report = await buildAnalyticsReport(store, options);
    expect(report.totals.liveVisitors).toBe(baseline.totals.liveVisitors + 1);
  });
});
