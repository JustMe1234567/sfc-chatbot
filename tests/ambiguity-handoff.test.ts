import { beforeAll, describe, expect, it } from "vitest";
import {
  ask,
  askRaw,
  confirmHandoffYes,
  loadHistory,
  startConversation,
  TEST_ORIGIN,
  useTempDatabase,
  warmChatbotService,
} from "./helpers";
import {
  authRequest,
  CookieJar,
  provisionStaff,
  signInAs,
} from "./auth-helpers";

const ADMIN_EMAIL = "owner@example.edu";
const ADMIN_PASSWORD = "owner-phrase-pilot-31";
const ADVISOR_EMAIL = "editor@example.edu";
const ADVISOR_PASSWORD = "editor-phrase-puzzle-9k";
const DESK_ADVISOR_EMAIL = "helper@example.edu";
const DESK_ADVISOR_PASSWORD = "helper-phrase-branch-4q";

interface Choice {
  id: string;
  topic: string;
}

interface ReplyBody {
  conversation: { id: string; state: string };
  reply: { text: string; link?: string; choices?: Choice[] } | null;
}

async function askWithChoice(
  conversation: { id: string; token: string },
  choice: string,
  text: string,
): Promise<Response> {
  return askRaw(conversation, JSON.stringify({ choice, text }));
}

async function putPhrases(jar: CookieJar, phrases: string[]): Promise<Response> {
  const { PUT } = await import(
    "../src/app/api/staff/settings/escalation-phrases/route"
  );
  return PUT(
    new Request(`${TEST_ORIGIN}/api/staff/settings/escalation-phrases`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie: jar.header(), origin: TEST_ORIGIN },
      body: JSON.stringify({ phrases }),
    }),
  );
}

async function getPhrases(jar: CookieJar): Promise<{ phrases: string[] }> {
  const { GET } = await import(
    "../src/app/api/staff/settings/escalation-phrases/route"
  );
  const response = await GET(
    new Request(`${TEST_ORIGIN}/api/staff/settings/escalation-phrases`, {
      headers: { cookie: jar.header() },
    }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as { phrases: string[] };
}

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await warmChatbotService();
  await provisionStaff({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: "Olive", role: "admin" });
  await provisionStaff({ email: ADVISOR_EMAIL, password: ADVISOR_PASSWORD, name: "Eddie",  });
  await provisionStaff({ email: DESK_ADVISOR_EMAIL, password: DESK_ADVISOR_PASSWORD, name: "Sam" });
});

describe("several matching rules offer choices", () => {
  it("answers with topic choices instead of guessing, and they survive a reload", async () => {
    const conversation = await startConversation();

    const response = await ask(conversation, "How do I apply and what are the tuition fees?");
    expect(response.status).toBe(200);
    const body = (await response.json()) as ReplyBody;
    expect(body.conversation.state).toBe("bot_active");
    expect(body.reply?.choices ?? []).toEqual(
      expect.arrayContaining([
        { id: "admissions-overview", topic: "Admissions" },
        { id: "fees-overview", topic: "Fees" },
      ]),
    );
    // The offered topics are named so screen readers and reloads keep context.
    expect(body.reply?.text).toContain("Admissions");
    expect(body.reply?.text).toContain("Fees");

    const history = await loadHistory(conversation);
    const historyBody = (await history.json()) as {
      messages: { choices?: Choice[] }[];
    };
    expect(historyBody.messages.at(-1)?.choices?.map((choice) => choice.id)).toEqual(
      expect.arrayContaining(["admissions-overview", "fees-overview"]),
    );
  });

  it("rejects an unknown or unpublished selection", async () => {
    const conversation = await startConversation();
    const bogus = await askWithChoice(conversation, "no-such-rule", "Anything");
    expect(bogus.status).toBe(400);
    const body = (await bogus.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_choice");
  });
});

describe("the visitor's selected choice answers", () => {
  it("returns exactly the chosen rule's approved response", async () => {
    const conversation = await startConversation();
    await ask(conversation, "How do I apply and what are the tuition fees?");

    // Stray text alongside a selection is ignored: the transcript records
    // the picked topic, not visitor-authored words.
    const selection = await askWithChoice(conversation, "fees-overview", "Totally different words");
    expect(selection.status).toBe(200);
    const body = (await selection.json()) as ReplyBody;
    expect(body.conversation.state).toBe("bot_active");
    expect(body.reply?.text).toContain("$3,500");
    expect(body.reply?.link).toBe("https://www.springfieldcollege.edu/fees");

    const history = await loadHistory(conversation);
    const historyBody = (await history.json()) as {
      messages: { role: string; text: string }[];
    };
    expect(historyBody.messages.map((message) => [message.role, message.text])).toEqual([
      ["visitor", "How do I apply and what are the tuition fees?"],
      ["bot", expect.stringContaining("Admissions")],
      ["visitor", "Fees"],
      ["bot", expect.stringContaining("$3,500")],
    ]);
  });

  it("does not answer a selection once staff help is requested", async () => {
    const conversation = await startConversation();
    await ask(conversation, "Something no rule covers at all, escalate me");
    await askWithChoice(conversation, "request-human", "Chat with a human");
    // Ticket 43 locks visitor input while staff help is requested but
    // unclaimed: a stale selection is rejected outright, so nothing is
    // recorded and no bot answer could fire either way.
    const stalePick = await askWithChoice(conversation, "fees-overview", "Fees");
    expect(stalePick.status).toBe(409);

    const history = await loadHistory(conversation);
    const body = (await history.json()) as {
      conversation: { state: string };
      messages: { role: string }[];
    };
    expect(body.conversation.state).toBe("awaiting_staff");
    expect(body.messages.at(-1)?.role).toBe("bot");
  });
});

describe("seeded handoff phrases work out of the box", () => {
  it("prompts a seeded-phrase question even though a rule matches, and escalates on Yes", async () => {
    // Order-dependent by nature: the seed applies only while the setting has
    // never been configured, so assert it explicitly before anything saves a
    // phrase list.
    const editorJar = new CookieJar();
    await signInAs(editorJar, ADVISOR_EMAIL, ADVISOR_PASSWORD);
    expect((await getPhrases(editorJar)).phrases).toEqual([
      "talk to a person",
      "speak to a human",
    ]);

    const conversation = await startConversation();
    const response = await ask(conversation, "Can I talk to a person about the fees?");
    const body = (await response.json()) as ReplyBody;
    // The phrase asks before acting (ticket 69): no answer from the rule,
    // no escalation yet.
    expect(body.conversation.state).toBe("bot_active");
    expect(body.reply?.text).toBe("Would you like a staff member to join this chat?");
    expect(body.reply?.text).not.toContain("$3,500");

    const yes = await confirmHandoffYes(conversation);
    const yesBody = (await yes.json()) as ReplyBody;
    expect(yesBody.conversation.state).toBe("awaiting_staff");
  });
});

describe("configured handoff phrases take priority over answer rules", () => {
  it("prompts when the question contains a configured phrase, and hands off on Yes", async () => {
    const editorJar = new CookieJar();
    await signInAs(editorJar, ADVISOR_EMAIL, ADVISOR_PASSWORD);
    const saved = await putPhrases(editorJar, [
      "speak to a human",
      "I would like an operator",
    ]);
    expect(saved.status).toBe(200);

    // The question matches the admissions rule, but the phrase wins — with
    // any casing and punctuation, since matching normalizes both.
    const conversation = await startConversation();
    const response = await ask(conversation, "HOW do I APPLY? i want to   SPEAK-to-a-HUMAN!");
    const body = (await response.json()) as ReplyBody;
    expect(body.conversation.state).toBe("bot_active");
    expect(body.reply?.choices?.map((choice) => choice.id)).toEqual([
      "handoff-yes",
      "handoff-no",
    ]);

    const yes = await confirmHandoffYes(conversation);
    const yesBody = (await yes.json()) as ReplyBody;
    expect(yesBody.conversation.state).toBe("awaiting_staff");
    expect(yesBody.reply?.text).toContain("handed our conversation to the college staff");
  });

  it("applies configuration changes on the very next question, without a redeploy", async () => {
    const editorJar = new CookieJar();
    await signInAs(editorJar, ADVISOR_EMAIL, ADVISOR_PASSWORD);
    const changed = await putPhrases(editorJar, ["connect me with the registrar"]);
    expect(changed.status).toBe(200);
    const read = await getPhrases(editorJar);
    expect(read.phrases).toEqual(["connect me with the registrar"]);

    const conversation = await startConversation();
    const response = await ask(conversation, "Please connect me with the registrar.");
    const body = (await response.json()) as ReplyBody;
    expect(body.conversation.state).toBe("bot_active");
    expect(body.reply?.text).toBe("Would you like a staff member to join this chat?");
    const yes = await confirmHandoffYes(conversation);
    expect(((await yes.json()) as ReplyBody).conversation.state).toBe("awaiting_staff");
  });

  it("matches phrases as whole phrases, not inside other words", async () => {
    const editorJar = new CookieJar();
    await signInAs(editorJar, ADVISOR_EMAIL, ADVISOR_PASSWORD);
    await putPhrases(editorJar, ["speak to a human"]);

    // "humane" must not trigger "speak to a human": the rule answer wins.
    const conversation = await startConversation();
    const response = await ask(conversation, "How do I apply to your humane society program?");
    const body = (await response.json()) as ReplyBody;
    expect(body.conversation.state).toBe("bot_active");
    expect(body.reply?.text).toContain("admissions portal");
  });
});

describe("unknown questions offer a visitor-consented handoff", () => {
  it("offers human help when no rule or phrase applies", async () => {
    const conversation = await startConversation();
    const response = await ask(conversation, "What is the canteen menu on Thursdays?");
    const body = (await response.json()) as ReplyBody;
    expect(body.conversation.state).toBe("bot_active");
    expect(body.reply?.choices).toEqual([
      { id: "request-human", topic: "Chat with a human" },
    ]);
  });

  it("does not match rule keywords inside other words", async () => {
    const conversation = await startConversation();
    const response = await ask(conversation, "Do you sell coffee on campus?");
    const body = (await response.json()) as ReplyBody;
    expect(body.conversation.state).toBe("bot_active");
    expect(body.reply?.choices?.[0]?.id).toBe("request-human");
  });
});

describe("escalation-phrase configuration authorization", () => {
  it("lets both dashboard roles read and write, and refuses untrusted origins", async () => {
    // Ticket 102: the escalation phrases are chatbot content in the Answers
    // area, so the admin and the admissions advisor both hold them.
    const adminJar = new CookieJar();
    await signInAs(adminJar, ADMIN_EMAIL, ADMIN_PASSWORD);
    const saved = await putPhrases(adminJar, ["admin configured this"]);
    expect(saved.status).toBe(200);

    const advisorJar = new CookieJar();
    await signInAs(advisorJar, DESK_ADVISOR_EMAIL, DESK_ADVISOR_PASSWORD);
    const allowed = await putPhrases(advisorJar, ["advisor configured this"]);
    expect(allowed.status).toBe(200);

    const { PUT } = await import(
      "../src/app/api/staff/settings/escalation-phrases/route"
    );
    const crossSite = await PUT(
      new Request(`${TEST_ORIGIN}/api/staff/settings/escalation-phrases`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          cookie: adminJar.header(),
          origin: "https://evil.example.net",
        },
        body: JSON.stringify({ phrases: ["evil"] }),
      }),
    );
    expect(crossSite.status).toBe(403);

    const anonymous = await putPhrases(new CookieJar(), ["anonymous"]);
    expect(anonymous.status).toBe(401);
  });

  it("rejects malformed phrase lists", async () => {
    const editorJar = new CookieJar();
    await signInAs(editorJar, ADVISOR_EMAIL, ADVISOR_PASSWORD);
    const notAList = await putPhrases(editorJar, "not a list" as unknown as string[]);
    expect(notAList.status).toBe(400);
    const punctuationOnly = await putPhrases(editorJar, ["?!?"]);
    expect(punctuationOnly.status).toBe(400);
    const oversized = await putPhrases(editorJar, ["x".repeat(201)]);
    expect(oversized.status).toBe(400);
  });
});
