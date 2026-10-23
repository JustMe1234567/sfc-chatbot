import { beforeAll, describe, expect, it } from "vitest";
import { ask, loadHistory, startConversation, useTempDatabase, warmChatbotService } from "./helpers";
import { openDatabase } from "../src/db/sqlite";

let dbPath: string;

beforeAll(async () => {
  dbPath = useTempDatabase();
  await warmChatbotService();
});

describe("visitor session expiry", () => {
  it("stops unlocking the conversation once the credential expires", async () => {
    const conversation = await startConversation();
    const response = await ask(conversation, "What are the admission requirements?");
    expect(response.status).toBe(200);

    // Fast-forward the clock at the persistence layer: the HTTP seam cannot
    // time-travel, and the spec allows asserting persisted state directly.
    const db = openDatabase(dbPath);
    db.prepare("UPDATE visitor_sessions SET expires_at = ?").run(
      new Date(Date.now() - 1000).toISOString(),
    );

    const history = await loadHistory(conversation);
    expect(history.status).toBe(404);
  });
});
