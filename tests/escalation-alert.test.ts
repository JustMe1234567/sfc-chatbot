import { beforeAll, describe, expect, it } from "vitest";
import {
  ask,
  confirmHandoffYes,
  countQuery,
  startConversation,
  useTempDatabase,
  warmChatbotService,
} from "./helpers";

beforeAll(async () => {
  useTempDatabase();
  await warmChatbotService();
});

describe("sound-only staff notifications", () => {
  it("raises desk attention without creating email or delivery records", async () => {
    const conversation = await startConversation();
    await ask(conversation, "Can I speak to a human about visiting campus?");
    await confirmHandoffYes(conversation);

    const { getChatbotService } = await import("../src/db/service");
    const { db, store } = await getChatbotService();
    const alerts = await db.get<{ count: number }>(
      countQuery(
        "SELECT COUNT(*)::int AS count FROM notifications WHERE conversation_id = ?",
        "SELECT COUNT(*) AS count FROM notifications WHERE conversation_id = ?",
      ),
      conversation.id,
    );
    const mails = await db.get<{ count: number }>(
      countQuery(
        "SELECT COUNT(*)::int AS count FROM mail_outbox",
        "SELECT COUNT(*) AS count FROM mail_outbox",
      ),
    );
    const attention = await store.getConversation(conversation.id);

    expect(alerts?.count).toBe(0);
    expect(mails?.count).toBe(0);
    expect(attention?.attentionAt).not.toBeNull();
  });
});
