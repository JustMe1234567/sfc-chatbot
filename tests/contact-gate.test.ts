import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ask,
  askRaw,
  countQuery,
  confirmHandoffYes,
  loadHistory,
  startConversation,
  startConversationRaw,
  submitContact,
  TEST_CONTACT,
  TEST_ORIGIN,
  useTempDatabase,
  warmChatbotService,
  type ConversationStart,
} from "./helpers";
import { CookieJar, provisionStaff, signInAs } from "./auth-helpers";
import { repoRoot } from "../src/paths";
import type { ConversationState } from "../src/domain/types";

/**
 * Ticket 66: every new chat requires the visitor's full name, email, and
 * phone. The server is the gate — it validates the details, stores them
 * with the conversation, and refuses messages and topic choices on any
 * conversation without them, so a direct request or a session from before
 * the requirement cannot get past the widget's form.
 */

const OWNER_EMAIL = "gate-owner@example.edu";
const OWNER_PASSWORD = "gate-owner-lantern-41";
const STAFF_EMAIL = "gate-staff@example.edu";
const STAFF_PASSWORD = "gate-staff-lantern-42";

async function service() {
  const { getChatbotService } = await import("../src/db/service");
  return getChatbotService();
}

async function count(postgresSql: string, sqliteSql: string, ...params: string[]): Promise<number> {
  const { db } = await service();
  const row = (await db.get<{ n: number }>(countQuery(postgresSql, sqliteSql), ...params)) as {
    n: number;
  };
  return Number(row.n);
}

function conversationCount(): Promise<number> {
  return count(
    "SELECT COUNT(*)::int AS n FROM conversations",
    "SELECT COUNT(*) AS n FROM conversations",
  );
}

/** How many conversations still hold any of the three contact values. */
function rowsHolding(contact: typeof TEST_CONTACT): Promise<number> {
  return count(
    "SELECT COUNT(*)::int AS n FROM conversations WHERE visitor_name = ? OR visitor_email = ? OR visitor_phone = ?",
    "SELECT COUNT(*) AS n FROM conversations WHERE visitor_name = ? OR visitor_email = ? OR visitor_phone = ?",
    contact.fullName,
    contact.email,
    contact.phone,
  );
}

/**
 * A conversation from before the gate, with a live visitor credential: no
 * contact details, exactly what a pre-ticket session still holds.
 */
async function legacyConversation(state: ConversationState = "bot_active"): Promise<ConversationStart> {
  const { store } = await service();
  const { createSessionToken, hashSessionToken, sessionExpiry } = await import(
    "../src/domain/tokens"
  );
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await store.createConversation({
    id,
    state,
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
  return { id, token };
}

async function errorCode(response: Response): Promise<string | undefined> {
  return ((await response.json()) as { error?: { code?: string } }).error?.code;
}

async function staffJar(email: string, password: string): Promise<CookieJar> {
  const jar = new CookieJar();
  await signInAs(jar, email, password);
  return jar;
}

async function deskList(jar: CookieJar | null, view?: "history"): Promise<Response> {
  const { GET } = await import("../src/app/api/staff/conversations/route");
  return GET(
    new Request(`${TEST_ORIGIN}/api/staff/conversations${view ? "?view=history" : ""}`, {
      headers: jar ? { cookie: jar.header() } : {},
    }),
  );
}

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await warmChatbotService();
  await provisionStaff({ email: OWNER_EMAIL, password: OWNER_PASSWORD, name: "Olive", role: "owner" });
  await provisionStaff({ email: STAFF_EMAIL, password: STAFF_PASSWORD, name: "Sam" });
});

describe("starting a chat requires valid contact details", () => {
  it("rejects blank, invalid, and excessively long values without creating anything", async () => {
    const before = await conversationCount();
    const rejected: [unknown, string][] = [
      // A direct request with no body at all: the pre-ticket contract.
      [undefined, "invalid_name"],
      [{}, "invalid_name"],
      [{ ...TEST_CONTACT, fullName: "" }, "invalid_name"],
      [{ ...TEST_CONTACT, fullName: "   " }, "invalid_name"],
      [{ ...TEST_CONTACT, fullName: 42 }, "invalid_name"],
      [{ ...TEST_CONTACT, fullName: "a".repeat(81) }, "invalid_name"],
      [{ ...TEST_CONTACT, email: "" }, "invalid_email"],
      [{ ...TEST_CONTACT, email: "not-an-email" }, "invalid_email"],
      [{ ...TEST_CONTACT, email: `${"a".repeat(250)}@example.org` }, "invalid_email"],
      [{ ...TEST_CONTACT, phone: "" }, "invalid_phone"],
      [{ ...TEST_CONTACT, phone: "12345" }, "invalid_phone"],
      [{ ...TEST_CONTACT, phone: "call me maybe" }, "invalid_phone"],
      [{ ...TEST_CONTACT, phone: "1".repeat(16) }, "invalid_phone"],
      [{ ...TEST_CONTACT, phone: `555 010 0199${" ".repeat(20)}1` }, "invalid_phone"],
    ];
    for (const [body, code] of rejected) {
      const response = await startConversationRaw(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await errorCode(response), JSON.stringify(body)).toBe(code);
    }
    expect(await conversationCount()).toBe(before);
  });

  it("starts exactly one conversation carrying the trimmed details", async () => {
    const before = await conversationCount();
    const response = await startConversationRaw({
      fullName: "  Maya Okafor ",
      email: " maya@example.org ",
      phone: " +44 20 7946 0958 ",
    });
    expect(response.status).toBe(201);
    const started = (await response.json()) as ConversationStart;
    expect(await conversationCount()).toBe(before + 1);

    const { store } = await service();
    const stored = await store.getConversation(started.id);
    expect(stored?.visitorName).toBe("Maya Okafor");
    expect(stored?.visitorEmail).toBe("maya@example.org");
    expect(stored?.visitorPhone).toBe("+44 20 7946 0958");
    expect(stored?.state).toBe("bot_active");
  });

  it("resumes a valid existing conversation without asking again", async () => {
    const conversation = await startConversation();
    const history = await loadHistory(conversation);
    expect(history.status).toBe(200);
    expect(((await history.json()) as { contactRequired: boolean }).contactRequired).toBe(false);
    expect((await ask(conversation, "How do I apply?")).status).toBe(200);
  });
});

describe("the server-side gate on conversations without accepted details", () => {
  it("refuses typed questions, topic choices, and handoff requests posted directly", async () => {
    const legacy = await legacyConversation();
    const { store } = await service();
    const rule = (await store.listPublishedAnswerRules())[0];
    if (!rule) {
      throw new Error("the seed has no published answer rule");
    }

    const attempts = [
      JSON.stringify({ text: "How do I apply?" }),
      JSON.stringify({ choice: rule.id }),
      JSON.stringify({ choice: "request-human" }),
      // An escalation phrase is the strongest route past the bot.
      JSON.stringify({ text: "I need to speak to a human right now." }),
    ];
    for (const body of attempts) {
      const response = await askRaw(legacy, body);
      expect(response.status, body).toBe(409);
      expect(await errorCode(response), body).toBe("contact_required");
    }

    // Nothing was answered or escalated: no transcript, no alert, no state
    // change, and the staff desk raised no attention.
    expect(await store.listMessages(legacy.id)).toEqual([]);
    const after = await store.getConversation(legacy.id);
    expect(after?.state).toBe("bot_active");
    expect(after?.attentionAt).toBeNull();
    expect(
      await count(
        "SELECT COUNT(*)::int AS n FROM notifications WHERE conversation_id = ?",
        "SELECT COUNT(*) AS n FROM notifications WHERE conversation_id = ?",
        legacy.id,
      ),
    ).toBe(0);
  });

  it("keeps a legacy conversation readable and reports the gate to the widget", async () => {
    const legacy = await legacyConversation();
    const { store } = await service();
    await store.appendMessage({
      id: crypto.randomUUID(),
      conversationId: legacy.id,
      role: "visitor",
      text: "A question from before the contact form existed.",
      createdAt: new Date().toISOString(),
    });

    const history = await loadHistory(legacy);
    expect(history.status).toBe(200);
    const body = (await history.json()) as {
      contactRequired: boolean;
      messages: { text: string }[];
    };
    expect(body.contactRequired).toBe(true);
    expect(body.messages.map((message) => message.text)).toEqual([
      "A question from before the contact form existed.",
    ]);
  });
});

describe("unlocking an existing conversation", () => {
  it("accepts details on exactly that conversation and opens it for chat", async () => {
    const legacy = await legacyConversation();
    const before = await conversationCount();

    const unlocked = await submitContact(legacy, {
      fullName: "Ines Duarte",
      email: "ines@example.org",
      phone: "555 010 0142",
    });
    expect(unlocked.status).toBe(200);
    expect(((await unlocked.json()) as { id: string }).id).toBe(legacy.id);
    // Unlocking never opens a second conversation.
    expect(await conversationCount()).toBe(before);

    const { store } = await service();
    const stored = await store.getConversation(legacy.id);
    expect(stored?.visitorName).toBe("Ines Duarte");
    expect(stored?.visitorEmail).toBe("ines@example.org");
    expect(stored?.visitorPhone).toBe("555 010 0142");

    expect(((await (await loadHistory(legacy)).json()) as { contactRequired: boolean }).contactRequired).toBe(false);
    expect((await ask(legacy, "How do I apply?")).status).toBe(200);
  });

  it("rejects invalid details and leaves the conversation locked", async () => {
    const legacy = await legacyConversation();

    const invalid = await submitContact(legacy, { ...TEST_CONTACT, phone: "n/a" });
    expect(invalid.status).toBe(400);
    expect(await errorCode(invalid)).toBe("invalid_phone");
    const missing = await submitContact(legacy, { fullName: "Only A Name" });
    expect(missing.status).toBe(400);

    const stillLocked = await ask(legacy, "How do I apply?");
    expect(stillLocked.status).toBe(409);
    expect(await errorCode(stillLocked)).toBe("contact_required");
  });

  it("answers a repeated submission without rewriting accepted details", async () => {
    const conversation = await startConversation({ fullName: "First Accepted" });

    const repeat = await submitContact(conversation, {
      fullName: "Someone Else",
      email: "else@example.org",
      phone: "555 010 0177",
    });
    expect(repeat.status).toBe(200);
    const { store } = await service();
    const stored = await store.getConversation(conversation.id);
    expect(stored?.visitorName).toBe("First Accepted");
    expect(stored?.visitorEmail).toBe(TEST_CONTACT.email);
  });

  it("is authorized by the conversation's own credential only", async () => {
    const legacy = await legacyConversation();
    const outsider = await startConversation();

    const hijack = await submitContact({ id: legacy.id, token: outsider.token });
    expect(hijack.status).toBe(404);

    const { POST } = await import("../src/app/api/v1/conversations/[id]/contact/route");
    const anonymous = await POST(
      new Request(`${TEST_ORIGIN}/api/v1/conversations/${legacy.id}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(TEST_CONTACT),
      }),
      { params: Promise.resolve({ id: legacy.id }) },
    );
    expect(anonymous.status).toBe(401);

    const { store } = await service();
    expect((await store.getConversation(legacy.id))?.visitorName).toBeNull();
  });

  it("never revives a closed conversation", async () => {
    const legacy = await legacyConversation("closed");
    const refused = await submitContact(legacy);
    expect(refused.status).toBe(409);
    expect(await errorCode(refused)).toBe("conversation_closed");
    const { store } = await service();
    expect((await store.getConversation(legacy.id))?.visitorName).toBeNull();
  });
});

describe("staff see the name beside the state", () => {
  it("carries the name on the desk list, with a fallback for legacy conversations", async () => {
    const named = await startConversation({ fullName: "Priya Raman" });
    const legacy = await legacyConversation();
    // Rows appear on the desk once the visitor has said something (ticket
    // 73): both conversations ask, so the name and its fallback render.
    expect((await ask(named, "Contact gate: a named visitor's question.")).status).toBe(200);
    // The legacy fallback is real pre-gate data: the visitor's words are
    // already in the store (no gate ever applied to them).
    {
      const { store } = await service();
      await store.appendMessage({
        id: crypto.randomUUID(),
        conversationId: legacy.id,
        role: "visitor",
        text: "Contact gate: a legacy visitor's pre-gate question.",
        createdAt: new Date().toISOString(),
        choices: undefined,
      });
    }
    const { deskLabel } = await import("../src/domain/inbox");

    const jar = await staffJar(STAFF_EMAIL, STAFF_PASSWORD);
    const response = await deskList(jar);
    expect(response.status).toBe(200);
    const desk = (await response.json()) as {
      active: { id: string; state: ConversationState; visitorName: string | null }[];
    };
    const namedRow = desk.active.find((item) => item.id === named.id);
    const legacyRow = desk.active.find((item) => item.id === legacy.id);
    expect(namedRow && deskLabel(namedRow)).toBe("Priya Raman · bot");
    expect(legacyRow && deskLabel(legacyRow)).toBe("Visitor · bot");
  });

  it("never exposes the fields on an unauthenticated staff surface", async () => {
    const conversation = await startConversation({ fullName: "Hidden From Strangers" });

    const list = await deskList(null);
    expect(list.status).toBe(401);
    expect(await list.text()).not.toContain("Hidden From Strangers");

    const { GET } = await import("../src/app/api/staff/conversations/[id]/route");
    const transcript = await GET(
      new Request(`${TEST_ORIGIN}/api/staff/conversations/${conversation.id}`),
      { params: Promise.resolve({ id: conversation.id }) },
    );
    expect(transcript.status).toBe(401);
    const body = await transcript.text();
    expect(body).not.toContain("Hidden From Strangers");
    expect(body).not.toContain(TEST_CONTACT.email);
    expect(body).not.toContain(TEST_CONTACT.phone);
  });
});

describe("contact details leave with the conversation", () => {
  async function closedConversation(contact: typeof TEST_CONTACT): Promise<ConversationStart> {
    const conversation = await startConversation(contact);
    await ask(conversation, "How do I apply?");
    const { store } = await service();
    await store.closeConversation(conversation.id);
    return conversation;
  }

  it("removes all three fields on manual delete", async () => {
    const contact = {
      fullName: "Delete Me Manually",
      email: "manual-delete@example.org",
      phone: "555 010 0301",
    };
    const conversation = await closedConversation(contact);
    expect(await rowsHolding(contact)).toBe(1);

    const jar = await staffJar(STAFF_EMAIL, STAFF_PASSWORD);
    const { POST } = await import("../src/app/api/staff/conversations/[id]/delete/route");
    const deleted = await POST(
      new Request(`${TEST_ORIGIN}/api/staff/conversations/${conversation.id}/delete`, {
        method: "POST",
        headers: { cookie: jar.header(), origin: TEST_ORIGIN },
      }),
      { params: Promise.resolve({ id: conversation.id }) },
    );
    expect(deleted.status).toBe(200);
    expect(await rowsHolding(contact)).toBe(0);
  });

  it("removes all three fields when retention expires the conversation", async () => {
    const contact = {
      fullName: "Expired By Retention",
      email: "retention@example.org",
      phone: "555 010 0302",
    };
    const conversation = await closedConversation(contact);
    const { db, store } = await service();
    await db.run(
      "UPDATE conversations SET closed_at = ? WHERE id = ?",
      new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
      conversation.id,
    );

    const { runRetentionSweep } = await import("../src/domain/retention");
    const result = await runRetentionSweep(db, store);
    expect(result?.removedConversations).toBeGreaterThanOrEqual(1);
    expect(await rowsHolding(contact)).toBe(0);
  });

  it("removes all three fields on Clear history", async () => {
    const contact = {
      fullName: "Cleared With History",
      email: "clear-history@example.org",
      phone: "555 010 0303",
    };
    await closedConversation(contact);
    expect(await rowsHolding(contact)).toBe(1);

    const jar = await staffJar(OWNER_EMAIL, OWNER_PASSWORD);
    const { POST } = await import("../src/app/api/staff/conversations/clear-history/route");
    const cleared = await POST(
      new Request(`${TEST_ORIGIN}/api/staff/conversations/clear-history`, {
        method: "POST",
        headers: { cookie: jar.header(), origin: TEST_ORIGIN },
      }),
    );
    expect(cleared.status).toBe(200);
    expect(await rowsHolding(contact)).toBe(0);
  });

  it("never copies the fields into analytics or notification-sound metadata", async () => {
    const contact = {
      fullName: "Zebedee Quillfeather",
      email: "zebedee.quillfeather@example.org",
      phone: "555 010 0399",
    };
    const conversation = await startConversation(contact);
    // An escalation exercises every write the chat makes outside its own
    // row: analytics rollups, the staff alert, and the attention signal.
    await ask(conversation, "Nothing covers this; I need to speak to a human.");
    await confirmHandoffYes(conversation);

    const { db } = await service();
    const outside = JSON.stringify([
      await db.all("SELECT * FROM analytics_daily"),
      await db.all("SELECT * FROM analytics_seen"),
      await db.all("SELECT * FROM notifications"),
      await db.all("SELECT * FROM audit_log"),
      await db.all("SELECT * FROM mail_outbox"),
    ]);
    for (const value of Object.values(contact)) {
      expect(outside, value).not.toContain(value);
    }

    // The sound cue's event feed is the conversation id and the attention
    // instant — nothing a visitor typed about themselves.
    const { deskAttentionEvents, summarizeConversationDesk } = await import("../src/domain/inbox");
    const { store } = await service();
    const desk = await summarizeConversationDesk(store);
    const events = JSON.stringify(deskAttentionEvents([...desk.incoming, ...desk.active]));
    expect(events).toContain(conversation.id);
    for (const value of Object.values(contact)) {
      expect(events, value).not.toContain(value);
    }
  });
});

describe("the widget's contact gate", () => {
  // Ticket 33 moved the frame page's logic into hooks per concern: the
  // conversation stream owns the gate flag and the send guard, the
  // contact-gate hook owns the form flow, and the clear-flow hook owns the
  // clear. The pins follow the code.
  const STREAM = "src/app/widget/frame/hooks/useConversationStream.ts";
  const GATE = "src/app/widget/frame/hooks/useContactGate.ts";
  const CLEAR = "src/app/widget/frame/hooks/useClearFlow.ts";

  async function read(rel: string): Promise<string> {
    return readFile(path.join(repoRoot(), rel), "utf8");
  }

  it("opens on three clearly labeled required fields with brief copy", async () => {
    const frame = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/page.tsx"),
      "utf8",
    );
    const stream = await read(STREAM);
    // The gate is on from the first paint; only a stored session's
    // confirmed conversation turns it off.
    expect(stream).toContain("useState(true)");
    for (const [id, label] of [
      ["sfcw-name", "Full name"],
      ["sfcw-email", "Email"],
      ["sfcw-phone", "Phone"],
    ] as const) {
      // A visible label tied to its input, and the input is required.
      expect(frame).toMatch(
        new RegExp(`<label className=\\{styles\\.contactLabel\\} htmlFor="${id}">\\s*${label}\\s*</label>`),
      );
      expect(frame).toMatch(new RegExp(`id="${id}"[\\s\\S]{0,200}?required`));
    }
    expect(frame).toContain("Please share your contact details to start this chat.");
    expect(frame).toContain('"Start chat"');
  });

  it("hides every way to ask until the details are accepted", async () => {
    const frame = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/page.tsx"),
      "utf8",
    );
    const stream = await read(STREAM);
    // The form replaces the composer rather than sitting beside it, and
    // carries no dismiss control: closing the widget is the only exit, and
    // reopening shows the same form.
    expect(frame).toMatch(/\{contactRequired \? \([\s\S]*?<form className=\{styles\.contactForm\}/);
    const form = frame.slice(
      frame.indexOf("<form className={styles.contactForm}"),
      frame.indexOf('<form className={styles.form}'),
    );
    expect(form).not.toContain("setContactRequired(false)");
    expect(form).not.toMatch(/Skip|No thanks|Not now|Cancel/);
    // Suggestions, the topic strip, and offered choices all wait on it.
    // (Ticket 67: the chip lists read `visibleTopics`, the deduped topics.)
    expect(frame).toContain("!contactRequired && visibleTopics.length > 0");
    expect(frame).toContain("!freshStart && !contactRequired && visibleTopics.length > 0");
    expect(frame).toContain("message.choices && !contactRequired");
    // A send can never start while the gate stands.
    expect(stream).toMatch(/sendingRef\.current \|\|\s*contactRequired/);
  });

  it("submits to the server, shows pending and failure feedback, and keeps the values", async () => {
    const frame = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/page.tsx"),
      "utf8",
    );
    const gate = await read(GATE);
    // Unlock the conversation already held, otherwise start one — always
    // with the details, never the old bodiless create.
    expect(gate).toContain("/contact`");
    expect(gate).toMatch(/fetch\("\/api\/v1\/conversations", \{\s*method: "POST",\s*headers/);
    expect(gate).not.toContain('fetch("/api/v1/conversations", { method: "POST" })');
    // The duplicate-submit guard holds across awaits.
    expect(gate).toContain("if (contactBusyRef.current) {");
    // Pending and failure feedback are visible and announced.
    expect(frame).toContain("Starting…");
    expect(frame).toContain("aria-busy={gate.contactBusy || undefined}");
    expect(frame).toMatch(/className=\{styles\.contactError\} role="alert"/);
    // A failed submission leaves the typed values alone: the form state is
    // only ever written by the inputs themselves.
    expect(frame.match(/setContact\(/g)).toHaveLength(3);
    // The welcome greeting follows a successful save.
    expect(gate).toMatch(/function contactAccepted\(\): void \{[\s\S]*?greet\(\);/);
  });

  it("returns to the form after Clear chat and after a lapsed or closed chat", async () => {
    const stream = await read(STREAM);
    const clearFlow = await read(CLEAR);
    const clear = clearFlow.slice(
      clearFlow.indexOf("async function confirmClear"),
      clearFlow.indexOf("return {", clearFlow.indexOf("async function confirmClear")),
    );
    // Only a dead credential returns to the gate directly; any other
    // failure keeps the conversation the server still holds open.
    expect(clear).toContain('response.status === 401 || response.status === 404');
    expect(clear).toContain("showLockedFreshChat()");
    expect(clear).toContain("showError()");
    expect(clear).not.toContain("greet()");
    // A dead credential, a closure, or a quiet day return to the gate; the
    // server's own demand keeps the credential so the form unlocks the
    // same conversation in place.
    expect(stream).toContain('conflict.error?.code === "conversation_closed"');
    expect(stream).toContain('conflict.error?.code === "conversation_inactive"');
    expect(stream).toContain('conflict.error?.code === "contact_required"');
    expect(stream).toMatch(
      /code === "contact_required"[\s\S]*?setContactRequired\(true\);\s*return;/,
    );
    expect(stream).toMatch(/function showLockedFreshChat[\s\S]*?setContactRequired\(true\)/);
  });
});
