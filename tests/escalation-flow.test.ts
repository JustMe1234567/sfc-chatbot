import { beforeAll, describe, expect, it } from "vitest";
import { ask, loadHistory, startConversation, useTempDatabase } from "./helpers";

beforeAll(() => {
  useTempDatabase();
});

describe("unknown question reaches the shared inbox", () => {
  it("raises one escalation with a handoff message the visitor can see", async () => {
    const conversation = await startConversation();

    const response = await ask(conversation, "Can you book me a campus tour next Tuesday?");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      conversation: { state: string };
      reply: { text: string } | null;
    };
    expect(body.conversation.state).toBe("awaiting_staff");
    expect(body.reply?.text).toContain("handed our conversation to the college staff team");

    // The escalation and the handoff message survive a reload.
    const history = await loadHistory(conversation);
    const historyBody = (await history.json()) as {
      conversation: { state: string };
      messages: { role: string; text: string }[];
    };
    expect(historyBody.conversation.state).toBe("awaiting_staff");
    expect(historyBody.messages.at(-1)?.role).toBe("bot");
    expect(historyBody.messages.at(-1)?.text).toContain("college staff team");
  });

  it("pauses automated answers without raising a second escalation", async () => {
    const conversation = await startConversation();
    await ask(conversation, "What are the admission requirements?");

    await ask(conversation, "Can you book me a campus tour next Tuesday?");
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
    ]);
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
});
