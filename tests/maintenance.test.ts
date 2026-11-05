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
    // With no period configured the sweep runs at the 30-day default
    // (ticket 47); on a fresh database nothing has expired yet, so the run
    // reports zero removals where the pre-47 contract reported "disabled".
    expect(body.removedConversations).toBe(0);
    delete process.env.CRON_SECRET;
  });

  it("accepts same-origin page traffic when no secret is configured", async () => {
    const response = await maintenance({ origin: TEST_ORIGIN });
    expect(response.status).toBe(200);
  });
});

describe("the Trash purge (ticket 58)", () => {
  it("permanently removes answers 30 days after they entered Trash, and nothing else", async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { store } = await getChatbotService();
    const expired = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const fresh = new Date().toISOString();
    await store.upsertAnswerRule({
      id: "trash-expired-58",
      topic: "Expired trash",
      response: "Long gone from Trash.",
      phrases: ["expired trash question 58"],
      status: "trashed",
      updatedAt: expired,
      publishedBy: null,
      reviewedAt: null,
      trashedAt: expired,
    });
    await store.upsertAnswerRule({
      id: "trash-fresh-58",
      topic: "Fresh trash",
      response: "Still within its 30 days.",
      phrases: ["fresh trash question 58"],
      status: "trashed",
      updatedAt: fresh,
      publishedBy: null,
      reviewedAt: null,
      trashedAt: fresh,
    });
    await store.upsertAnswerRule({
      id: "archived-old-58",
      topic: "Archived forever",
      response: "Archived answers are never purged.",
      phrases: ["archived question 58"],
      status: "archived",
      updatedAt: expired,
      publishedBy: null,
      reviewedAt: null,
      trashedAt: null,
    });

    process.env.CRON_SECRET = "test-cron-secret";
    const first = await maintenance({ authorization: "Bearer test-cron-secret" });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { answersPurged: number }).answersPurged).toBe(1);
    expect(await store.getAnswerRule("trash-expired-58")).toBeNull();
    // Inside the window: still restorable, so still present.
    expect((await store.getAnswerRule("trash-fresh-58"))?.status).toBe("trashed");
    // Archived answers are out of the purge's reach entirely.
    expect((await store.getAnswerRule("archived-old-58"))?.status).toBe("archived");
    // The active answers and the wider world are untouched.
    expect(await store.getAnswerRule("admissions-overview")).not.toBeNull();

    // A repeated pass is safe and counts nothing.
    const second = await maintenance({ authorization: "Bearer test-cron-secret" });
    expect(((await second.json()) as { answersPurged: number }).answersPurged).toBe(0);
    delete process.env.CRON_SECRET;
  });
});
