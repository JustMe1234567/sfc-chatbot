import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ask,
  askRaw,
  countQuery,
  loadHistory,
  startConversation,
  TEST_ORIGIN,
  useTempDatabase,
  warmChatbotService,
  type ConversationStart,
} from "./helpers";
import {
  CookieJar,
  enrollTotp,
  provisionStaff,
  signInWithTotp,
  staffApiRequest,
} from "./auth-helpers";
import {
  distinctOptions,
  handoffOptionReply,
  handoffOptionTopic,
  topicLabelsShadowedByOptions,
} from "../src/domain/handoffOptions";
import type { SupportHours } from "../src/domain/types";
import { repoRoot } from "../src/paths";

/**
 * Ticket 67: clickable suggestions that request staff handoff. The pictured
 * phrases are seeded as click-to-handoff options — distinct from published
 * answer rules and typed Handoff phrases — editable in the Answers admin
 * area, rendered on the fresh chat and after bot answers, and hidden while
 * typing, while sending, and once staff help is requested or claimed.
 * Clicking records the label as the visitor's words, acknowledges the topic
 * truthfully, and escalates exactly once through the existing path — even
 * when a published rule covers the same wording. Typing the same wording
 * keeps normal answer matching.
 */

const OWNER_EMAIL = "options-owner@example.edu";
const OWNER_PASSWORD = "options-owner-harbor-7n";
const EDITOR_EMAIL = "options-editor@example.edu";
const EDITOR_PASSWORD = "options-editor-ridge-3k";
const STAFF_EMAIL = "options-staff@example.edu";
const STAFF_PASSWORD = "options-staff-quiet-8v";
const ALERT_RECIPIENT = "desk-options@example.edu";

let ownerTotp: Awaited<ReturnType<typeof enrollTotp>>;
let editorTotp: Awaited<ReturnType<typeof enrollTotp>>;
let staffTotp: Awaited<ReturnType<typeof enrollTotp>>;

const ADMISSIONS_OPTION = "I want to speak to someone in admissions";
const COURSE_PRICES_OPTION = "I have a question about course prices";
const FINANCIAL_AID_OPTION = "I have a question about financial aid";

/** A published rule that deliberately covers the same topic as an option. */
const AID_RULE = {
  id: "aid-options-67",
  topic: "Financial aid",
  response: "Aid amounts for the next term are set each spring.",
  phrases: ["financial aid"],
  keywords: [] as string[][],
  status: "published" as const,
  updatedAt: "2026-11-01T09:00:00.000Z",
  publishedBy: null,
  reviewedAt: "2026-11-01T09:00:00.000Z",
  trashedAt: null,
};

async function service(): Promise<Awaited<ReturnType<typeof import("../src/db/service").getChatbotService>>> {
  const { getChatbotService } = await import("../src/db/service");
  return getChatbotService();
}

async function count(
  postgresSql: string,
  sqliteSql: string,
  ...params: string[]
): Promise<number> {
  const { db } = await service();
  const row = (await db.get<{ n: number }>(countQuery(postgresSql, sqliteSql), ...params)) as {
    n: number;
  };
  return Number(row.n);
}

function escalationAlerts(conversationId: string): Promise<number> {
  return count(
    "SELECT COUNT(*)::int AS n FROM notifications WHERE type = 'escalation_alert' AND conversation_id = ?",
    "SELECT COUNT(*) AS n FROM notifications WHERE type = 'escalation_alert' AND conversation_id = ?",
    conversationId,
  );
}

async function mailsTo(address: string): Promise<number> {
  return count(
    "SELECT COUNT(*)::int AS n FROM mail_outbox WHERE to_address = ?",
    "SELECT COUNT(*) AS n FROM mail_outbox WHERE to_address = ?",
    address,
  );
}

async function errorCode(response: Response): Promise<string | undefined> {
  return ((await response.json()) as { error?: { code?: string } }).error?.code;
}

async function fetchPublicOptions(): Promise<Response> {
  const { GET } = await import("../src/app/api/v1/handoff-options/route");
  return GET(
    new Request(`${TEST_ORIGIN}/api/v1/handoff-options`, { headers: { origin: TEST_ORIGIN } }),
  );
}

async function putOptions(
  jar: CookieJar,
  options: string[],
  origin = TEST_ORIGIN,
): Promise<Response> {
  const { PUT } = await import("../src/app/api/staff/settings/handoff-options/route");
  return PUT(
    new Request(`${TEST_ORIGIN}/api/staff/settings/handoff-options`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie: jar.header(), origin },
      body: JSON.stringify({ options }),
    }),
  );
}

async function getStaffOptions(jar: CookieJar): Promise<{ options: string[] }> {
  const { GET } = await import("../src/app/api/staff/settings/handoff-options/route");
  const response = await GET(
    new Request(`${TEST_ORIGIN}/api/staff/settings/handoff-options`, {
      headers: { cookie: jar.header() },
    }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as { options: string[] };
}

/** The widget's click: a distinct request field, not typed text. */
async function clickOption(conversation: ConversationStart, label: string): Promise<Response> {
  return askRaw(conversation, JSON.stringify({ handoffOption: label }));
}

async function staffPost(
  jar: CookieJar,
  conversationId: string,
  action: "claim" | "reply" | "close",
  body?: unknown,
): Promise<Response> {
  const route = await import(
    `../src/app/api/staff/conversations/[id]/${action}/route`
  );
  return route.POST(
    new Request(`${TEST_ORIGIN}/api/staff/conversations/${conversationId}/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: jar.header(),
        origin: TEST_ORIGIN,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    { params: Promise.resolve({ id: conversationId }) },
  );
}

async function staffJar(
  email: string,
  password: string,
  totp: Awaited<ReturnType<typeof enrollTotp>>,
): Promise<CookieJar> {
  const jar = new CookieJar();
  await signInWithTotp(jar, email, password, totp);
  return jar;
}

async function putRecipients(jar: CookieJar, recipients: string[]): Promise<Response> {
  const { PUT } = await import("../src/app/api/staff/settings/alert-recipients/route");
  return PUT(
    new Request(`${TEST_ORIGIN}/api/staff/settings/alert-recipients`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie: jar.header(), origin: TEST_ORIGIN },
      body: JSON.stringify({ recipients }),
    }),
  );
}

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await warmChatbotService();
  await provisionStaff({ email: OWNER_EMAIL, password: OWNER_PASSWORD, name: "Olive", role: "owner" });
  await provisionStaff({ email: EDITOR_EMAIL, password: EDITOR_PASSWORD, name: "Eddie", role: "editor" });
  await provisionStaff({ email: STAFF_EMAIL, password: STAFF_PASSWORD, name: "Sam" });
  ownerTotp = await enrollTotp(new CookieJar(), OWNER_EMAIL, OWNER_PASSWORD);
  editorTotp = await enrollTotp(new CookieJar(), EDITOR_EMAIL, EDITOR_PASSWORD);
  staffTotp = await enrollTotp(new CookieJar(), STAFF_EMAIL, STAFF_PASSWORD);
  const { store } = await service();
  // A published rule deliberately covering the same topic as an option:
  // every click test below proves the click bypasses it.
  await store.upsertAnswerRule({ ...AID_RULE });
  const owner = await staffJar(OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
  await putRecipients(owner, [ALERT_RECIPIENT]);
});

describe("the seeded options (ticket 67)", () => {
  it("seeds the three pictured phrases in order, served publicly like topics", async () => {
    // Order-dependent by nature: the seed applies only while the setting has
    // never been configured, so this must run before any editor save.
    const response = await fetchPublicOptions();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { options: string[] };
    expect(body.options).toEqual([
      ADMISSIONS_OPTION,
      COURSE_PRICES_OPTION,
      FINANCIAL_AID_OPTION,
    ]);
  });
});

describe("the Answers admin surface for options", () => {
  it("applies editor saves on the very next fetch, without a redeploy", async () => {
    const editor = await staffJar(EDITOR_EMAIL, EDITOR_PASSWORD, editorTotp);
    const saved = await putOptions(editor, [
      ADMISSIONS_OPTION,
      "Please connect me with the registrar",
    ]);
    expect(saved.status).toBe(200);
    expect((await getStaffOptions(editor)).options).toEqual([
      ADMISSIONS_OPTION,
      "Please connect me with the registrar",
    ]);
    const body = (await (await fetchPublicOptions()).json()) as { options: string[] };
    expect(body.options).toEqual([ADMISSIONS_OPTION, "Please connect me with the registrar"]);

    // Editing and removing work the same way; end on the seeded three so the
    // click tests below always have the financial-aid option configured.
    const restored = await putOptions(editor, [
      ADMISSIONS_OPTION,
      COURSE_PRICES_OPTION,
      FINANCIAL_AID_OPTION,
    ]);
    expect(restored.status).toBe(200);
  });

  it("rejects malformed option lists", async () => {
    const editor = await staffJar(EDITOR_EMAIL, EDITOR_PASSWORD, editorTotp);
    expect((await putOptions(editor, "not a list" as unknown as string[])).status).toBe(400);
    expect((await putOptions(editor, ["?!?"])).status).toBe(400);
    expect((await putOptions(editor, ["x".repeat(201)])).status).toBe(400);
    expect(
      (await putOptions(editor, Array.from({ length: 51 }, (_, i) => `option ${i}`))).status,
    ).toBe(400);
  });

  it("is editor-role territory: plain staff, anonymous, and untrusted origins refused", async () => {
    const staff = await staffJar(STAFF_EMAIL, STAFF_PASSWORD, staffTotp);
    expect((await putOptions(staff, ["staff cannot"])).status).toBe(403);

    expect((await putOptions(new CookieJar(), ["anonymous"])).status).toBe(401);

    const owner = await staffJar(OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    expect((await putOptions(owner, ["evil"], "https://evil.example.net")).status).toBe(403);
  });
});

describe("a deliberate click hands off exactly once", () => {
  it("records the label, acknowledges the topic, and bypasses the competing rule", async () => {
    const conversation = await startConversation();
    const clicked = await clickOption(conversation, FINANCIAL_AID_OPTION);
    expect(clicked.status).toBe(200);
    const body = (await clicked.json()) as {
      conversation: { state: string };
      reply: { text: string } | null;
    };
    expect(body.conversation.state).toBe("awaiting_staff");
    // Truthful topic-aware acknowledgment — not the "can't answer" prefix,
    // and never the competing rule's response.
    expect(body.reply?.text).toContain("financial aid");
    expect(body.reply?.text).toContain("notified our team");
    expect(body.reply?.text).toContain("as soon as they're available");
    expect(body.reply?.text).not.toContain("can't answer");
    expect(body.reply?.text).not.toContain(AID_RULE.response);

    const history = await loadHistory(conversation);
    const historyBody = (await history.json()) as {
      messages: { role: string; text: string }[];
    };
    // The label itself is recorded as the visitor's words.
    expect(historyBody.messages.map((message) => [message.role, message.text])).toEqual([
      ["visitor", FINANCIAL_AID_OPTION],
      ["bot", expect.stringContaining("financial aid")],
    ]);
  });

  it("notifies the desk once: one alert row, one email to the configured recipient", async () => {
    const conversation = await startConversation();
    expect(await escalationAlerts(conversation.id)).toBe(0);
    const mailsBefore = await mailsTo(ALERT_RECIPIENT);
    const clicked = await clickOption(conversation, ADMISSIONS_OPTION);
    expect(clicked.status).toBe(200);

    expect(await escalationAlerts(conversation.id)).toBe(1);
    // Exactly one email per conversation's escalation, whatever earlier
    // tests already sent to the same recipient.
    expect(await mailsTo(ALERT_RECIPIENT)).toBe(mailsBefore + 1);

    // The desk shows the conversation in Incoming with attention feedback.
    const owner = await staffJar(OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    const deskResponse = await staffApiRequest(owner, "/api/staff/conversations");
    const desk = (await deskResponse.json()) as {
      incoming: { id: string; attention: boolean }[];
    };
    expect(desk.incoming).toContainEqual(
      expect.objectContaining({ id: conversation.id, attention: true }),
    );
  });

  it("locks out a repeat click while waiting, so nothing duplicates", async () => {
    const conversation = await startConversation();
    expect((await clickOption(conversation, COURSE_PRICES_OPTION)).status).toBe(200);
    const mailsBefore = await mailsTo(ALERT_RECIPIENT);

    const repeat = await clickOption(conversation, COURSE_PRICES_OPTION);
    expect(repeat.status).toBe(409);
    expect(await errorCode(repeat)).toBe("awaiting_staff");
    expect(await escalationAlerts(conversation.id)).toBe(1);
    expect(await mailsTo(ALERT_RECIPIENT)).toBe(mailsBefore);

    const history = await loadHistory(conversation);
    const historyBody = (await history.json()) as {
      messages: { role: string; text: string }[];
    };
    expect(
      historyBody.messages.filter((message) => message.role === "visitor").map((m) => m.text),
    ).toEqual([COURSE_PRICES_OPTION]);
  });

  it("lets staff take over and reply in the same chat", async () => {
    const conversation = await startConversation();
    await clickOption(conversation, FINANCIAL_AID_OPTION);
    const jar = await staffJar(STAFF_EMAIL, STAFF_PASSWORD, staffTotp);
    expect((await staffPost(jar, conversation.id, "claim")).status).toBe(200);
    const reply = await staffPost(jar, conversation.id, "reply", {
      text: "Hi, Sam from the aid office here. How can I help?",
    });
    expect(reply.status).toBe(200);

    const history = await loadHistory(conversation);
    const historyBody = (await history.json()) as {
      conversation: { state: string };
      messages: { role: string; text: string }[];
    };
    expect(historyBody.conversation.state).toBe("claimed");
    expect(historyBody.messages.at(-1)?.role).toBe("staff");
    expect(historyBody.messages.at(-1)?.text).toContain("Sam from the aid office");
  });
});

describe("a claimed chat never re-escalates from a click", () => {
  it("records the words for staff but adds no second handoff", async () => {
    const conversation = await startConversation();
    await clickOption(conversation, ADMISSIONS_OPTION);
    const jar = await staffJar(STAFF_EMAIL, STAFF_PASSWORD, staffTotp);
    await staffPost(jar, conversation.id, "claim");
    const mailsBefore = await mailsTo(ALERT_RECIPIENT);

    const clicked = await clickOption(conversation, COURSE_PRICES_OPTION);
    expect(clicked.status).toBe(200);
    const body = (await clicked.json()) as {
      conversation: { state: string };
      reply: { text: string } | null;
    };
    expect(body.conversation.state).toBe("claimed");
    expect(body.reply).toBeNull();
    expect(await escalationAlerts(conversation.id)).toBe(1);
    expect(await mailsTo(ALERT_RECIPIENT)).toBe(mailsBefore);

    const history = await loadHistory(conversation);
    const historyBody = (await history.json()) as {
      messages: { role: string; text: string }[];
    };
    expect(
      historyBody.messages.filter((message) => message.role === "visitor").map((m) => m.text),
    ).toEqual([ADMISSIONS_OPTION, COURSE_PRICES_OPTION]);
  });
});

describe("typing the same wording keeps normal matching", () => {
  it("answers from the competing rule instead of handing off", async () => {
    const conversation = await startConversation();
    const response = await ask(conversation, FINANCIAL_AID_OPTION);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      conversation: { state: string };
      reply: { text: string } | null;
    };
    expect(body.conversation.state).toBe("bot_active");
    expect(body.reply?.text).toBe(AID_RULE.response);
    expect(await escalationAlerts(conversation.id)).toBe(0);
  });

  it("still honors a separately configured typed handoff phrase first", async () => {
    const editor = await staffJar(EDITOR_EMAIL, EDITOR_PASSWORD, editorTotp);
    const saved = await putEscalationPhrases(editor, ["question about financial aid"]);
    expect(saved.status).toBe(200);

    const conversation = await startConversation();
    const response = await ask(conversation, FINANCIAL_AID_OPTION);
    const body = (await response.json()) as {
      conversation: { state: string };
      reply: { text: string } | null;
    };
    expect(body.conversation.state).toBe("awaiting_staff");
    // The typed path keeps its own handoff wording — not the option's.
    expect(body.reply?.text).toContain("can't answer");
    expect(body.reply?.text).not.toContain("Thanks for asking about");

    // Restore the launch defaults for any later reader.
    await putEscalationPhrases(editor, ["talk to a person", "speak to a human"]);
  });
});

describe("gate, closure, and unknown clicks", () => {
  it("stays behind the contact gate", async () => {
    const { store } = await service();
    const { createSessionToken, hashSessionToken, sessionExpiry } = await import(
      "../src/domain/tokens"
    );
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await store.createConversation({
      id,
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
    });
    const token = createSessionToken();
    await store.createSession({
      tokenHash: hashSessionToken(token),
      conversationId: id,
      createdAt: now,
      expiresAt: sessionExpiry(),
    });

    const response = await askRaw(
      { id, token },
      JSON.stringify({ handoffOption: ADMISSIONS_OPTION }),
    );
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("contact_required");
    const history = await loadHistory({ id, token });
    expect(((await history.json()) as { messages: unknown[] }).messages).toEqual([]);
  });

  it("refuses clicks on a closed conversation", async () => {
    const { store } = await service();
    const conversation = await startConversation();
    await store.updateConversationState(conversation.id, "closed");
    const response = await clickOption(conversation, ADMISSIONS_OPTION);
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("conversation_closed");
  });

  it("rejects a label that is not a configured option, appending nothing", async () => {
    const conversation = await startConversation();
    const response = await clickOption(conversation, "Enroll me in unicorn studies");
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("invalid_handoff_option");
    const history = await loadHistory(conversation);
    expect(((await history.json()) as { messages: unknown[] }).messages).toEqual([]);
  });
});

describe("the acknowledgment follows support hours honestly", () => {
  it("keeps the availability wording while the desk is on duty", async () => {
    const owner = await staffJar(OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    // Always-open hours make on-duty deterministic regardless of run time.
    const saved = await putHours(owner, {
      timeZone: "Etc/GMT-2",
      days: [0, 1, 2, 3, 4, 5, 6],
      startMinute: 0,
      endMinute: 24 * 60,
    });
    expect(saved.status).toBe(200);

    const conversation = await startConversation();
    const clicked = await clickOption(conversation, ADMISSIONS_OPTION);
    const body = (await clicked.json()) as { reply: { text: string } | null };
    expect(body.reply?.text).toContain("admissions");
    expect(body.reply?.text).toContain("as soon as they're available");
    expect(body.reply?.text).not.toContain("when the desk is open");

    await putHours(owner, null);
  });

  it("builds the off-duty wording from the schedule without promising a time", () => {
    const hours: SupportHours = {
      timeZone: "UTC",
      days: [2],
      startMinute: 9 * 60,
      endMinute: 17 * 60,
    };
    // Wednesday noon UTC in a Tuesday-only window: off duty.
    const now = new Date("2026-03-11T12:00:00.000Z");
    const reply = handoffOptionReply(ADMISSIONS_OPTION, hours, now);
    expect(reply).toContain("admissions");
    expect(reply).toContain("notified our team");
    expect(reply).toContain("when the desk is open");
    expect(reply).toContain("Tuesday, 09:00–17:00 (UTC)");
    expect(reply).not.toContain("as soon as they're available");
    expect(reply).not.toContain("busy");
    expect(reply.toLowerCase()).not.toContain("shortly");
    // Ticket 66 removed return-link emails; new copy must not promise one.
    expect(reply).not.toContain("email");
  });

  it("mentions the topic for each seeded phrase and stays generic otherwise", () => {
    expect(handoffOptionTopic(ADMISSIONS_OPTION)).toBe("admissions");
    expect(handoffOptionTopic(COURSE_PRICES_OPTION)).toBe("course prices");
    expect(handoffOptionTopic(FINANCIAL_AID_OPTION)).toBe("financial aid");
    expect(handoffOptionTopic("Please connect me with the registrar")).toBeNull();
    // The topic quotes the label's own casing and keeps its inner
    // punctuation; only the sentence's trailing mark is trimmed.
    expect(handoffOptionTopic("I WANT to speak to someone in ADMISSIONS!")).toBe("ADMISSIONS");
    expect(handoffOptionTopic("I have a question about ESL/COVID-19 fees?")).toBe(
      "ESL/COVID-19 fees",
    );

    const generic = handoffOptionReply("Please connect me with the registrar", null);
    expect(generic).toContain("Thanks for reaching out.");
    expect(generic).toContain("notified our team");
  });
});

describe("duplicate chips for the same phrase", () => {
  it("shadows a topic label that a configured option spells, and only that one", () => {
    // Identical wordings after normalization shadow each other; a topic
    // merely about the same subject ("Financial aid" vs the full option
    // sentence) keeps its own chip.
    const shadowed = topicLabelsShadowedByOptions(
      ["Admissions", "Fees", "Financial aid"],
      ["fees!", FINANCIAL_AID_OPTION],
    );
    expect(shadowed.has("Fees")).toBe(true);
    expect(shadowed.has("Admissions")).toBe(false);
    expect(shadowed.has("Financial aid")).toBe(false);
  });

  it("collapses repeated spellings of the same option to their first occurrence", () => {
    expect(
      distinctOptions([
        FINANCIAL_AID_OPTION,
        "fees?",
        COURSE_PRICES_OPTION,
        "FEES!!",
        FINANCIAL_AID_OPTION,
      ]),
    ).toEqual([FINANCIAL_AID_OPTION, "fees?", COURSE_PRICES_OPTION]);
    expect(distinctOptions([])).toEqual([]);
  });
});

describe("the widget and admin surfaces carry the feature (source contract)", () => {
  const WIDGET = "src/app/widget/frame/page.tsx";

  async function read(rel: string): Promise<string> {
    return readFile(path.join(repoRoot(), rel), "utf8");
  }

  it("fetches the options and posts them as a distinct click field", async () => {
    const widget = await read(WIDGET);
    expect(widget).toContain('fetch("/api/v1/handoff-options")');
    expect(widget).toContain("handoffClick");
    // The click posts the option field, not typed text.
    expect(widget).toMatch(/handoffClick \? \{ handoffOption: text \} : \{ text \}/);
  });

  it("hides the options while typing, while sending, and once staff help is requested or claimed", async () => {
    const widget = await read(WIDGET);
    expect(widget).toContain("handoffOptionsVisible");
    expect(widget).toMatch(
      /handoffOptionsVisible =[\s\S]{0,120}!contactRequired &&[\s\S]{0,40}!sending &&[\s\S]{0,40}!handoff &&[\s\S]{0,40}!claimed &&[\s\S]{0,40}question\.trim\(\)\.length === 0/,
    );
  });

  it("renders real keyboard buttons in both the fresh stack and the ongoing rail", async () => {
    const widget = await read(WIDGET);
    // Keyboard use is the buttons themselves: both placements render real
    // <button type="button"> chips for the configured options — asserted on
    // each option-rendering slice, not a whole-file count.
    for (const start of [
      widget.indexOf('aria-label="Options to reach our staff"'),
      widget.lastIndexOf('aria-label="Options to reach our staff"'),
    ]) {
      if (start < 0) throw new Error("an options group is missing from the widget");
      const slice = widget.slice(start, widget.indexOf("</div>", start));
      expect(slice).toContain('type="button"');
      expect(slice).toContain("void send(option, undefined, true)");
      expect(slice).not.toContain("href=");
    }
    expect(widget).toContain("freshSuggestions");
    expect(widget).toContain("topicsShell");
    // A duplicate chip for the same phrase never renders — neither a topic
    // spelled by an option nor a repeated line in the configured list.
    expect(widget).toContain("topicLabelsShadowedByOptions");
    expect(widget).toContain("distinctOptions");
    // A failed click never stuffs the option into the composer: only typed
    // words are handed back.
    expect(widget).toMatch(/!choice && !handoffClick/);
  });

  it("adds a separate options tab to the Answers workspace with its own save flow", async () => {
    const workspace = await read("src/app/dashboard/answers/answers-workspace.tsx");
    expect(workspace).toContain('"options"');
    expect(workspace).toContain("HandoffOptionsForm");
    const form = await read("src/app/dashboard/answers/handoff-options-form.tsx");
    expect(form).toContain('"/api/staff/settings/handoff-options"');
    expect(form).toMatch(/method: "PUT"/);
    // Separate from the typed phrases' form and route.
    expect(form).not.toContain("escalation-phrases");
    const page = await read("src/app/dashboard/answers/page.tsx");
    expect(page).toContain("getHandoffOptions");
  });
});

/** The typed handoff-phrase saves for the priority test, via the phrases
    route this ticket deliberately leaves untouched. */
async function putEscalationPhrases(jar: CookieJar, phrases: string[]): Promise<Response> {
  const { PUT } = await import("../src/app/api/staff/settings/escalation-phrases/route");
  return PUT(
    new Request(`${TEST_ORIGIN}/api/staff/settings/escalation-phrases`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie: jar.header(), origin: TEST_ORIGIN },
      body: JSON.stringify({ phrases }),
    }),
  );
}

async function putHours(jar: CookieJar, hours: unknown): Promise<Response> {
  const { PUT } = await import("../src/app/api/staff/settings/support-hours/route");
  return PUT(
    new Request(`${TEST_ORIGIN}/api/staff/settings/support-hours`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", cookie: jar.header(), origin: TEST_ORIGIN },
      body: JSON.stringify({ hours }),
    }),
  );
}
