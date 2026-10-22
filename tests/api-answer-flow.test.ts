import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ask, loadHistory, startConversation, startTestServer, type TestServer } from "./helpers";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

describe("visitor asks a question through the public API", () => {
  it("returns only the seeded approved answer and its college page link for a known question", async () => {
    const conversation = await startConversation(server.baseUrl);

    const response = await ask(server.baseUrl, conversation, "What are the admission requirements?");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      reply: { text: string; link?: string };
    };
    expect(body.reply.text).toBe(
      "You can apply online through our admissions portal. Undergraduate applications ask for your high school transcript and one reference letter. See the admissions page for the full checklist.",
    );
    expect(body.reply.link).toBe("https://www.example-college.edu/admissions");
  });

  it("persists the visitor question and bot answer so they reappear after a reload", async () => {
    const conversation = await startConversation(server.baseUrl);
    await ask(server.baseUrl, conversation, "What are the admission requirements?");
    await ask(server.baseUrl, conversation, "How much are the tuition fees?");

    // A page reload is a fresh GET of the same conversation with the same token.
    const history = await loadHistory(server.baseUrl, conversation);
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
    const conversation = await startConversation(server.baseUrl);

    const response = await ask(
      server.baseUrl,
      conversation,
      "  WHAT are the ADMISSION requirements?! ",
    );

    const body = (await response.json()) as { reply: { text: string } };
    expect(body.reply.text).toContain("admissions portal");
  });

  it("does not match keywords inside other words", async () => {
    const conversation = await startConversation(server.baseUrl);

    const response = await ask(server.baseUrl, conversation, "Do you sell coffee on campus?");

    const body = (await response.json()) as { reply: { text: string } };
    expect(body.reply.text).not.toContain("$3,500");
  });

  it("never picks one answer when wording matches several rules", async () => {
    const conversation = await startConversation(server.baseUrl);

    const response = await ask(
      server.baseUrl,
      conversation,
      "How do I apply and what are the tuition fees?",
    );

    const body = (await response.json()) as { reply: { text: string } };
    expect(body.reply.text).not.toContain("admissions portal");
    expect(body.reply.text).not.toContain("$3,500");
  });

  it("does not answer from a draft rule", async () => {
    const conversation = await startConversation(server.baseUrl);

    const response = await ask(server.baseUrl, conversation, "Do you offer scholarships?");

    const body = (await response.json()) as { reply: { text: string } };
    expect(body.reply.text).not.toContain("Scholarship details");
  });
});

describe("visitor session credentials", () => {
  it("rejects history access without a token", async () => {
    const conversation = await startConversation(server.baseUrl);
    const response = await fetch(
      `${server.baseUrl}/api/v1/conversations/${conversation.id}/messages`,
    );
    expect(response.status).toBe(401);
  });

  it("rejects another visitor's token instead of leaking the conversation", async () => {
    const first = await startConversation(server.baseUrl);
    await ask(server.baseUrl, first, "What are the admission requirements?");

    const outsider = await startConversation(server.baseUrl);
    const response = await fetch(
      `${server.baseUrl}/api/v1/conversations/${first.id}/messages`,
      { headers: { Authorization: `Bearer ${outsider.token}` } },
    );
    expect(response.status).toBe(404);
  });
});

describe("public input limits", () => {
  it("rejects an oversized question", async () => {
    const conversation = await startConversation(server.baseUrl);
    const response = await ask(server.baseUrl, conversation, "a".repeat(1001));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("too_long");
  });

  it("rejects an empty or whitespace-only question", async () => {
    const conversation = await startConversation(server.baseUrl);
    for (const text of ["", "   "]) {
      const response = await ask(server.baseUrl, conversation, text);
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("empty");
    }
  });

  it("rejects a question that is not text", async () => {
    const conversation = await startConversation(server.baseUrl);
    const response = await fetch(
      `${server.baseUrl}/api/v1/conversations/${conversation.id}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${conversation.token}`,
        },
        body: JSON.stringify({ text: 5 }),
      },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid");
  });

  it("throttles repeated questions from one conversation", async () => {
    const conversation = await startConversation(server.baseUrl);
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) {
      const response = await ask(server.baseUrl, conversation, `Question number ${i}?`);
      statuses.push(response.status);
    }
    expect(statuses.filter((status) => status === 200)).toHaveLength(20);
    expect(statuses.filter((status) => status === 429)).toHaveLength(2);
  });

  it("throttles repeated history reads from one conversation", async () => {
    const conversation = await startConversation(server.baseUrl);
    let throttled = 0;
    for (let i = 0; i < 61; i++) {
      const response = await loadHistory(server.baseUrl, conversation);
      if (response.status === 429) {
        throttled += 1;
      } else {
        expect(response.status).toBe(200);
      }
    }
    expect(throttled).toBe(1);
  });

  it("throttles unauthenticated conversation creation bursts", async () => {
    // Its own server so the shared per-IP budget used by earlier tests does
    // not decide when throttling starts.
    const isolated = await startTestServer();
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 101; i++) {
        statuses.push((await fetch(`${isolated.baseUrl}/api/v1/conversations`, { method: "POST" })).status);
      }
      expect(statuses.filter((status) => status === 201)).toHaveLength(100);
      expect(statuses.filter((status) => status === 429)).toHaveLength(1);
    } finally {
      await isolated.close();
    }
  });
});
