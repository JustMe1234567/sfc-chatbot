import { beforeAll, describe, expect, it } from "vitest";
import type { Conversation } from "../src/domain/types";
import { testPostgresUrl, useTempDatabase, warmChatbotService } from "./helpers";

/**
 * Ticket 83: provisioning the per-file Postgres test database must be
 * idempotent per process. A second warmChatbotService() call — exactly what
 * ticket 74's describe-level re-warm does — used to DROP+CREATE the database
 * out from under the already-cached service singleton, erasing its schema
 * and data. The guarantee is observed through the portable Store surface so
 * the same test runs (and stays green, trivially) in SQLite mode.
 */
describe("the test database provisioning (ticket 83)", () => {
  beforeAll(async () => {
    useTempDatabase();
    await warmChatbotService();
  });

  // The name memo in useTempDatabase is the other half of at-most-once
  // provisioning: a second call minting a fresh name would provision a
  // second database while the cached singleton keeps serving the first.
  // Nothing to pin in SQLite mode, where no provisioning exists.
  it.runIf(testPostgresUrl())(
    "keeps the per-file database name stable across repeated useTempDatabase calls",
    () => {
      const firstUrl = process.env.DATABASE_URL;
      const firstName = process.env.CHATBOT_TEST_PG_DBNAME;
      useTempDatabase();
      expect(process.env.CHATBOT_TEST_PG_DBNAME).toBe(firstName);
      expect(process.env.DATABASE_URL).toBe(firstUrl);
    },
  );

  it("keeps the provisioned database and its data across a repeated warm-up", async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { store } = await getChatbotService();

    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: "provision-idempotent-1",
      state: "bot_active",
      createdAt: now,
      claimedBy: null,
      claimedAt: null,
      visitorName: null,
      visitorEmail: null,
      visitorPhone: null,
      visitorLastSeenAt: null,
      closedAt: null,
      replacedBy: null,
      lastActivityAt: now,
      attentionAt: null,
    };
    await store.createConversation(conversation);

    // The regression trigger: the second warm in this process must not
    // recreate the database the cached singleton is already serving.
    await warmChatbotService();

    // The row written before the second warm must survive it. Field asserts
    // instead of a whole-object equality: the stores default visitor fields
    // differently per dialect (postgres stamps visitor_last_seen_at with the
    // creation time), which is store semantics, not this ticket's subject.
    const survived = await store.getConversation(conversation.id);
    expect(survived?.id).toBe(conversation.id);
    expect(survived?.state).toBe("bot_active");
    expect(survived?.createdAt).toBe(conversation.createdAt);
  });
});
