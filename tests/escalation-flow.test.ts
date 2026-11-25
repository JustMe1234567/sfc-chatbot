import { beforeAll, describe, expect, it } from "vitest";
import { ask, askRaw, confirmHandoffYes, countQuery, loadHistory, startConversation, TEST_ORIGIN, useTempDatabase, warmChatbotService } from "./helpers";
import { CookieJar, provisionStaff, staffApiRequest, signInAs } from "./auth-helpers";

const OWNER_EMAIL = "consent-flow-owner@example.edu";
const OWNER_PASSWORD = "consent-flow-owner-password-8x";
const ownerJar = new CookieJar();

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await warmChatbotService();
  await provisionStaff({ email: OWNER_EMAIL, password: OWNER_PASSWORD, name: "Flow Owner", role: "admin" });
  await signInAs(ownerJar, OWNER_EMAIL, OWNER_PASSWORD);
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

  it("escalates with dashboard attention and enters Incoming only after the offer is clicked", async () => {
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

    // Ticket 103: while staff help is requested, the visitor can keep
    // messaging — the words are recorded for the claiming advisor and the
    // bot stays paused: no answer, no rule match.
    const second = await ask(conversation, "And what about parking permits?");
    expect(second.status).toBe(200);
    expect(((await second.json()) as { reply: unknown }).reply).toBeNull();

    const history = await loadHistory(conversation);
    const historyBody = (await history.json()) as {
      conversation: { state: string };
      messages: { role: string; text: string }[];
    };
    expect(historyBody.conversation.state).toBe("awaiting_staff");
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
    expect(alerts?.count).toBe(0);

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

  it("lets an escalation phrase bypass the consent offer, prompting instead (ticket 69)", async () => {
    const conversation = await startConversation();
    const response = await ask(conversation, "I need to speak to a human about admissions.");
    const body = (await response.json()) as {
      conversation: { state: string };
      reply: { text: string; choices?: { id: string }[] | null };
    };
    // The phrase asks the persisted confirmation — no consent offer, and no
    // escalation until the visitor chooses.
    expect(body.conversation.state).toBe("bot_active");
    expect(body.reply?.text).toBe("Would you like a staff member to join this chat?");
    expect(body.reply?.choices?.map((choice) => choice.id)).toEqual([
      "handoff-yes",
      "handoff-no",
    ]);

    const yes = await confirmHandoffYes(conversation);
    const yesBody = (await yes.json()) as {
      conversation: { state: string };
      reply: { text: string; choices?: { id: string }[] } | null;
    };
    expect(yesBody.conversation.state).toBe("awaiting_staff");
    expect(yesBody.reply?.text).toContain("handed our conversation to the college staff team");
    expect(yesBody.reply?.choices).toBeUndefined();
  });
});
