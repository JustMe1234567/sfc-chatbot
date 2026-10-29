import { beforeAll, describe, expect, it } from "vitest";
import { TEST_ORIGIN, useTempDatabase, warmChatbotService } from "./helpers";

/**
 * The scheduled maintenance endpoint (ticket 11): the Vercel cron (bearer
 * CRON_SECRET) and same-origin staff page traffic can run the retention and
 * analytics sweeps; everything else is rejected.
 */
beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await warmChatbotService();
});

async function maintenance(headers: Record<string, string>): Promise<Response> {
  const { GET } = await import("../src/app/api/maintenance/route");
  return GET(new Request(`${TEST_ORIGIN}/api/maintenance`, { headers }));
}

describe("maintenance endpoint authorization", () => {
  it("rejects requests without the cron secret or a trusted origin", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    expect((await maintenance({})).status).toBe(401);
    expect((await maintenance({ authorization: "Bearer wrong" })).status).toBe(401);
    expect((await maintenance({ origin: "https://evil.example" })).status).toBe(401);
    delete process.env.CRON_SECRET;
  });

  it("accepts the configured cron bearer and runs both sweeps", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    const response = await maintenance({ authorization: "Bearer test-cron-secret" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      removedConversations: number | null;
    };
    expect(body.ok).toBe(true);
    // Unconfigured retention disables the transcript sweep (null), the same
    // contract as the staff-traffic trigger (ticket 10).
    expect(body.removedConversations).toBeNull();
    delete process.env.CRON_SECRET;
  });

  it("accepts same-origin page traffic when no secret is configured", async () => {
    const response = await maintenance({ origin: TEST_ORIGIN });
    expect(response.status).toBe(200);
  });
});
