import { beforeAll, describe, expect, it } from "vitest";
import { ask, askRaw, countQuery, loadHistory, startConversation, TEST_ORIGIN, useTempDatabase, warmChatbotService } from "./helpers";
import { CookieJar, enrollTotp, provisionStaff, signInWithTotp, staffApiRequest } from "./auth-helpers";

const OWNER_EMAIL = "consent-flow-owner@example.edu";
const OWNER_PASSWORD = "consent-flow-owner-password-8x";
const ownerJar = new CookieJar();

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await warmChatbotService();
  await provisionStaff({ email: OWNER_EMAIL, password: OWNER_PASSWORD, name: "Flow Owner", role: "owner" });
  const totp = await enrollTotp(new CookieJar(), OWNER_EMAIL, OWNER_PASSWORD);
  await signInWithTotp(ownerJar, OWNER_EMAIL, OWNER_PASSWORD, totp);
});

describe("unknown question offers a visitor-consented handoff", () => {
  it("stays bot-active and persists one human-chat offer without escalating", async () => {
    const conversation = await startConversation();

    const response = await ask(conversation, "Can you book me a campus tour next Tuesday?");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      conversation: { state: string };
      reply: { text: string; choices?: { id: string; topic: string }[] } | null;
    };
    expect(body.conversation.state).toBe("bot_active");
    expect(body.reply?.text).toContain("don't have knowledge of that");
    expect(body.reply?.choices).toEqual([
      { id: "request-human", topic: "Chat with a human" },
    ]);

    // The offer survives a reload without creating staff work or pausing the bot.
    const history = await loadHistory(conversation);
    const historyBody = (await history.json()) as {
      conversation: { state: string };
      messages: { role: string; text: string; choices?: { id: string; topic: string }[] }[];
    };
    expect(historyBody.conversation.state).toBe("bot_active");
    expect(historyBody.messages.at(-1)?.role).toBe("bot");
    expect(historyBody.messages.at(-1)?.choices).toEqual([
      { id: "request-human", topic: "Chat with a human" },
    ]);

    const { getChatbotService } = await import("../src/db/service");
    const { db } = await getChatbotService();
    const escalation = await db.get<{ count: number }>(
      countQuery(
        "SELECT COUNT(*)::int AS count FROM notifications WHERE type = 'escalation_alert' AND conversation_id = ?",
        "SELECT COUNT(*) AS count FROM notifications WHERE type = 'escalation_alert' AND conversation_id = ?",
      ),
      conversation.id,
    );
    expect(escalation?.count).toBe(0);
  });

  it("escalates, alerts once, and enters Incoming only after the offer is clicked", async () => {
    const conversation = await startConversation();
    await ask(conversation, "What are the admission requirements?");

    await ask(conversation, "Can you book me a campus tour next Tuesday?");
    const clicked = await askRaw(conversation, JSON.stringify({ choice: "request-human" }));
    expect(clicked.status).toBe(200);
    const clickedBody = (await clicked.json()) as {
      conversation: { state: string };
      reply: { text: string } | null;
    };
    expect(clickedBody.conversation.state).toBe("awaiting_staff");
    expect(clickedBody.reply?.text).toContain("handed our conversation to the college staff team");

    const second = await ask(conversation, "And what about parking permits?");

    expect(second.status).toBe(200);
    const body = (await second.json()) as {
      conversation: { state: string };
      reply: { text: string } | null;
    };
    expect(body.conversation.state).toBe("awaiting_staff");
    expect(body.reply).toBeNull();

    const history = await loadHistory(conversation);
    const historyBody = (await history.json()) as {
      conversation: { state: string };
      messages: { role: string; text: string }[];
    };
    // Known questions after handoff also receive no automated answer: the
    // transcript ends on the visitor's message.
    expect(historyBody.messages.at(-1)?.role).toBe("visitor");
    expect(historyBody.messages.at(-1)?.text).toBe("And what about parking permits?");
    expect(historyBody.messages.map((message) => message.role)).toEqual([
      "visitor",
      "bot",
      "visitor",
      "bot",
      "visitor",
      "bot",
      "visitor",
    ]);

    const { getChatbotService } = await import("../src/db/service");
    const { db } = await getChatbotService();
    const alerts = await db.get<{ count: number }>(
      countQuery(
        "SELECT COUNT(*)::int AS count FROM notifications WHERE type = 'escalation_alert' AND conversation_id = ?",
        "SELECT COUNT(*) AS count FROM notifications WHERE type = 'escalation_alert' AND conversation_id = ?",
      ),
      conversation.id,
    );
    expect(alerts?.count).toBe(1);

    const deskResponse = await staffApiRequest(ownerJar, "/api/staff/conversations");
    const desk = (await deskResponse.json()) as {
      incoming: { id: string; attention: boolean }[];
    };
    expect(desk.incoming).toContainEqual(expect.objectContaining({ id: conversation.id, attention: true }));
  });

  it("keeps visitor credentials out of the staff inbox", async () => {
    const conversation = await startConversation();
    await ask(conversation, "Where can I park a helicopter?");
    // A visitor bearer credential is not a staff session: presenting it on a
    // staff endpoint still gets a plain 401.
    const { GET } = await import("../src/app/api/staff/conversations/route");
    const response = await GET(
      new Request("http://chatbot.test/api/staff/conversations", {
        headers: { Authorization: `Bearer ${conversation.token}` },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("keeps answering after an ignored offer and re-offers for a later unknown", async () => {
    const conversation = await startConversation();
    await ask(conversation, "Can you book me a campus tour next Tuesday?");

    const known = await ask(conversation, "What are the admission requirements?");
    const knownBody = (await known.json()) as {
      conversation: { state: string };
      reply: { text: string; choices?: unknown[] } | null;
    };
    expect(knownBody.conversation.state).toBe("bot_active");
    expect(knownBody.reply?.text).toContain("admissions portal");
    expect(knownBody.reply?.choices).toBeUndefined();

    const unknownAgain = await ask(conversation, "Do you rent bicycles on Sundays?");
    const unknownBody = (await unknownAgain.json()) as {
      conversation: { state: string };
      reply: { choices?: { id: string }[] } | null;
    };
    expect(unknownBody.conversation.state).toBe("bot_active");
    expect(unknownBody.reply?.choices).toEqual([
      expect.objectContaining({ id: "request-human" }),
    ]);
  });

  it("lets an escalation phrase bypass the consent offer", async () => {
    const conversation = await startConversation();
    const response = await ask(conversation, "I need to speak to a human about admissions.");
    const body = (await response.json()) as {
      conversation: { state: string };
      reply: { text: string; choices?: unknown[] } | null;
    };
    expect(body.conversation.state).toBe("awaiting_staff");
    expect(body.reply?.text).toContain("handed our conversation to the college staff team");
    expect(body.reply?.choices).toBeUndefined();
  });
});
