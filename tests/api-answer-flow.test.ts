import { beforeAll, describe, expect, it } from "vitest";
import {
  ask,
  askRaw,
  fetchHistoryWithoutToken,
  loadHistory,
  loadHistoryAs,
  startConversation,
  useTempDatabase,
  warmChatbotService,
} from "./helpers";

beforeAll(async () => {
  useTempDatabase();
  await warmChatbotService();
});

describe("visitor asks a question through the public API", () => {
  it("returns only the seeded approved answer and its college page link for a known question", async () => {
    const conversation = await startConversation();

    const response = await ask(conversation, "What are the admission requirements?");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      reply: { text: string; link?: string };
    };
    expect(body.reply.text).toBe(
      "You can apply online through our admissions portal. Undergraduate applications ask for your high school transcript and one reference letter. See the admissions page for the full checklist.",
    );
    expect(body.reply.link).toBe("https://www.springfieldcollege.edu/admissions");
  });

  it("persists the visitor question and bot answer so they reappear after a reload", async () => {
    const conversation = await startConversation();
    await ask(conversation, "What are the admission requirements?");
    await ask(conversation, "How much are the tuition fees?");

    // A reload inside the iframe is a fresh GET with the same credential.
    const history = await loadHistory(conversation);
    expect(history.status).toBe(200);
    const body = (await history.json()) as {
      messages: { role: string; text: string }[];
    };
    expect(body.messages.map((message) => [message.role, message.text])).toEqual([
      ["visitor", "What are the admission requirements?"],
      [
        "bot",
        "You can apply online through our admissions portal. Undergraduate applications ask for your high school transcript and one reference letter. See the admissions page for the full checklist.",
      ],
      ["visitor", "How much are the tuition fees?"],
      ["bot", "Tuition for most programs is $3,500 per semester. See the fees page for the current schedule."],
    ]);
  });

  it("answers case, punctuation, and wording variants of the same question", async () => {
    const conversation = await startConversation();

    const response = await ask(conversation, "  WHAT are the ADMISSION requirements?! ");

    const body = (await response.json()) as { reply: { text: string } };
    expect(body.reply.text).toContain("admissions portal");
  });

  it("does not match keywords inside other words", async () => {
    const conversation = await startConversation();

    const response = await ask(conversation, "Do you sell coffee on campus?");

    const body = (await response.json()) as { reply: { text: string } };
    expect(body.reply.text).not.toContain("$3,500");
  });

  it("never picks one answer when wording matches several rules", async () => {
    const conversation = await startConversation();

    const response = await ask(conversation, "How do I apply and what are the tuition fees?");

    const body = (await response.json()) as { reply: { text: string } };
    expect(body.reply.text).not.toContain("admissions portal");
    expect(body.reply.text).not.toContain("$3,500");
  });

  it("does not answer from a draft rule", async () => {
    const conversation = await startConversation();

    const response = await ask(conversation, "Do you offer scholarships?");

    const body = (await response.json()) as { reply: { text: string } };
    expect(body.reply.text).not.toContain("Scholarship details");
  });
});

describe("visitor session credentials", () => {
  it("rejects history access without a token", async () => {
    const conversation = await startConversation();
    const response = await fetchHistoryWithoutToken(conversation);
    expect(response.status).toBe(401);
  });

  it("rejects another visitor's token instead of leaking the conversation", async () => {
    const first = await startConversation();
    await ask(first, "What are the admission requirements?");

    const outsider = await startConversation();
    const response = await loadHistoryAs(outsider, first);
    expect(response.status).toBe(404);
  });
});

describe("public input limits", () => {
  it("rejects an oversized question", async () => {
    const conversation = await startConversation();
    const response = await ask(conversation, "a".repeat(1001));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("too_long");
  });

  it("rejects an empty or whitespace-only question", async () => {
    const conversation = await startConversation();
    for (const text of ["", "   "]) {
      const response = await ask(conversation, text);
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("empty");
    }
  });

  it("rejects a question that is not text", async () => {
    const conversation = await startConversation();
    const response = await askRaw(conversation, JSON.stringify({ text: 5 }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid");
  });

  it("throttles repeated questions from one conversation", async () => {
    const conversation = await startConversation();
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) {
      const response = await ask(conversation, `Question number ${i}?`);
      statuses.push(response.status);
    }
    expect(statuses.filter((status) => status === 200)).toHaveLength(20);
    expect(statuses.filter((status) => status === 429)).toHaveLength(2);
  });

  it("throttles repeated history reads from one conversation", async () => {
    const conversation = await startConversation();
    let throttled = 0;
    for (let i = 0; i < 61; i++) {
      const response = await loadHistory(conversation);
      if (response.status === 429) {
        throttled += 1;
      } else {
        expect(response.status).toBe(200);
      }
    }
    expect(throttled).toBe(1);
  });
});
