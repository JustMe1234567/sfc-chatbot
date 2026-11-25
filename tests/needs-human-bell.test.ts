import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ask,
  countQuery,
  startConversation,
  TEST_ORIGIN,
  useTempDatabase,
  warmChatbotService,
} from "./helpers";
import { CookieJar, provisionStaff, signInAs } from "./auth-helpers";
import { createNeedsHumanSignal, NEEDS_HUMAN_POLL_MS } from "../src/domain/needsHumanSignal";
import { repoRoot } from "../src/paths";

/**
 * Ticket 79: the needs-human bell on the Conversations navigation item —
 * the dashboard-wide visual counterpart to ticket 77's repeating alert.
 * One staff-only boolean endpoint answers exactly the desk's Needs-human
 * set (the buzzer's `desk.incoming`), and the sidebar polls it every ten
 * seconds while visible so the bell is correct from every dashboard page.
 * Presence is the message: no count is rendered anywhere, and editors —
 * whose role has no Conversations row — request nothing at all.
 */

const ADMIN_EMAIL = "bell-owner@example.edu";
const STAFF_EMAIL = "bell-staff@example.edu";
const ADVISOR_EMAIL = "bell-editor@example.edu";
const ADMIN_PASSWORD = "bell-owner-harbor-5w";
const STAFF_PASSWORD = "bell-staff-quiet-3m";
const ADVISOR_PASSWORD = "bell-editor-ridge-9k";

async function service(): Promise<Awaited<ReturnType<typeof import("../src/db/service").getChatbotService>>> {
  const { getChatbotService } = await import("../src/db/service");
  return getChatbotService();
}

async function staffJar(
  email: string,
  password: string,
): Promise<CookieJar> {
  const jar = new CookieJar();
  await signInAs(jar, email, password);
  return jar;
}

async function getNeedsHuman(jar: CookieJar): Promise<Response> {
  const { GET } = await import("../src/app/api/v1/needs-human/route");
  return GET(
    new Request(`${TEST_ORIGIN}/api/v1/needs-human`, {
      headers: { cookie: jar.header() },
    }),
  );
}

async function needsHuman(jar: CookieJar): Promise<boolean> {
  const response = await getNeedsHuman(jar);
  expect(response.status).toBe(200);
  return ((await response.json()) as { needsHuman: boolean }).needsHuman;
}

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await warmChatbotService();
  await provisionStaff({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: "Olive", role: "admin" });
  await provisionStaff({ email: STAFF_EMAIL, password: STAFF_PASSWORD, name: "Sam" });
  await provisionStaff({ email: ADVISOR_EMAIL, password: ADVISOR_PASSWORD, name: "Eddie",  });
});

describe("the staff-only needs-human endpoint (ticket 79)", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await getNeedsHuman(new CookieJar());
    expect(response.status).toBe(401);
  });

  it("answers advisors too — their role holds the Conversations row (ticket 102)", async () => {
    const advisor = await staffJar(ADVISOR_EMAIL, ADVISOR_PASSWORD);
    expect((await getNeedsHuman(advisor)).status).toBe(200);
    expect(await needsHuman(advisor)).toBe(false);
  });

  it("answers a plain boolean, false while nothing is waiting", async () => {
    const owner = await staffJar(ADMIN_EMAIL, ADMIN_PASSWORD);
    const response = await getNeedsHuman(owner);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    // One key, one boolean: presence is the message, so the payload stays
    // exactly the signal the sidebar needs — no count to accidentally show.
    expect(Object.keys(body)).toEqual(["needsHuman"]);
    expect(body.needsHuman).toBe(false);

    // Staff read the same signal from the same endpoint.
    const staff = await staffJar(STAFF_EMAIL, STAFF_PASSWORD);
    expect(await needsHuman(staff)).toBe(false);
  });

  it("is true exactly while a live desk conversation sits in awaiting_staff", async () => {
    const owner = await staffJar(ADMIN_EMAIL, ADMIN_PASSWORD);
    const staff = await staffJar(STAFF_EMAIL, STAFF_PASSWORD);
    const { store } = await service();

    // A real visitor chat: the visitor's own message puts it on the desk,
    // the escalation moves it into Needs human, and the bell's set is the
    // buzzer's set — one read model, never a second divergent one.
    const conversation = await startConversation();
    await ask(conversation, "Does the library open on weekends?");
    expect(await needsHuman(owner)).toBe(false);

    await store.updateConversationState(conversation.id, "awaiting_staff");
    expect(await needsHuman(owner)).toBe(true);
    expect(await needsHuman(staff)).toBe(true);

    // Taking over moves the conversation out of Needs human: the bell
    // hides again.
    await store.updateConversationState(conversation.id, "claimed");
    expect(await needsHuman(owner)).toBe(false);
  });

  it("stays true while any conversation is still waiting, and clears on the last one", async () => {
    const owner = await staffJar(ADMIN_EMAIL, ADMIN_PASSWORD);
    const { store } = await service();

    const first = await startConversation({ fullName: "Bee Apiarist" });
    await ask(first, "What time does the bookshop close?");
    const second = await startConversation({ fullName: "Cam Puser" });
    await ask(second, "Is parking free on campus?");
    await store.updateConversationState(first.id, "awaiting_staff");
    await store.updateConversationState(second.id, "awaiting_staff");
    expect(await needsHuman(owner)).toBe(true);

    await store.updateConversationState(first.id, "claimed");
    expect(await needsHuman(owner)).toBe(true);

    await store.updateConversationState(second.id, "closed");
    expect(await needsHuman(owner)).toBe(false);
  });

  it("follows the desk read model exactly: an awaiting conversation the desk omits is not Needs human", async () => {
    const owner = await staffJar(ADMIN_EMAIL, ADMIN_PASSWORD);
    const { store } = await service();
    // Ticket 73: conversations with no visitor-authored message never
    // reach the desk lists — a state flipped on one of them is invisible
    // to the buzzer, so it must be invisible to the bell too.
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await store.createConversation({
      id,
      state: "awaiting_staff",
      claimedBy: null,
      claimedAt: null,
      visitorName: "Ghost Gate",
      visitorEmail: null,
      visitorPhone: null,
      visitorLastSeenAt: null,
      closedAt: null,
      replacedBy: null,
      lastActivityAt: now,
      attentionAt: null,
      createdAt: now,
    });
    // The conversation itself exists and is waiting — the omission is the
    // desk's visitor-authored rule, not a missing row.
    const { db } = await service();
    const found = await db.get<{ n: number }>(
      countQuery(
        `SELECT COUNT(*)::int AS n FROM conversations WHERE id = ? AND state = 'awaiting_staff'`,
        `SELECT COUNT(*) AS n FROM conversations WHERE id = ? AND state = 'awaiting_staff'`,
      ),
      id,
    );
    expect(Number(found?.n)).toBe(1);
    expect(await needsHuman(owner)).toBe(false);
  });
});

describe("the needs-human signal cycle", () => {
  function ok(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200 });
  }

  it("polls on the ten-second cadence the ticket pins", () => {
    expect(NEEDS_HUMAN_POLL_MS).toBe(10_000);
  });

  it("adopts a boolean answer", async () => {
    const adopted: boolean[] = [];
    const signal = createNeedsHumanSignal({
      fetchResponse: async () => ok({ needsHuman: true }),
      visible: () => true,
      adopt: (value) => adopted.push(value),
    });
    await signal.poll();
    expect(adopted).toEqual([true]);
  });

  it("keeps the last state when the request fails or the body lies", async () => {
    const adopted: boolean[] = [];
    const signal = createNeedsHumanSignal({
      fetchResponse: async () => new Response("server trouble", { status: 500 }),
      visible: () => true,
      adopt: (value) => adopted.push(value),
    });
    await signal.poll();
    expect(adopted).toEqual([]);

    const junk = createNeedsHumanSignal({
      fetchResponse: async () => ok({ needsHuman: "yes" }),
      visible: () => true,
      adopt: (value) => adopted.push(value),
    });
    await junk.poll();
    expect(adopted).toEqual([]);

    const broken = createNeedsHumanSignal({
      fetchResponse: async () => {
        throw new Error("network gone");
      },
      visible: () => true,
      adopt: (value) => adopted.push(value),
    });
    await broken.poll();
    expect(adopted).toEqual([]);
  });

  it("polls nothing while the tab is hidden", async () => {
    let fetched = 0;
    const signal = createNeedsHumanSignal({
      fetchResponse: async () => {
        fetched += 1;
        return ok({ needsHuman: true });
      },
      visible: () => false,
      adopt: () => {
        throw new Error("a hidden tab must not adopt");
      },
    });
    await signal.poll();
    expect(fetched).toBe(0);
  });
});

describe("the sidebar wiring carries the bell (source contract)", () => {
  const HEADER = "src/app/dashboard/header.tsx";

  async function readHeader(): Promise<string> {
    return readFile(path.join(repoRoot(), HEADER), "utf8");
  }

  it("polls the endpoint on the pinned cadence, with an initial fetch and a visibility catch-up", async () => {
    const header = await readHeader();
    // One initial poll per mount — every dashboard page renders the header
    // fresh — then the ten-second interval while visible.
    expect(header).toContain("void signal.poll();");
    expect(header).toContain(
      "const timer = setInterval(() => void signal.poll(), NEEDS_HUMAN_POLL_MS);",
    );
    // The AutoRefresh visibility pattern: a hidden tab catches up as soon
    // as staff return instead of waiting for the next tick.
    expect(header).toContain('document.addEventListener("visibilitychange", onVisibilityChange);');
    expect(header).toMatch(
      /function onVisibilityChange\(\): void \{\s*if \(document\.visibilityState === "visible"\) \{\s*void signal\.poll\(\);/,
    );
    // The interval and the listener die with the effect.
    expect(header).toMatch(/clearInterval\(timer\);/);
    expect(header).toMatch(/removeEventListener\("visibilitychange", onVisibilityChange\);/);
  });

  it("runs the poll only for the roles that can see the Conversations row", async () => {
    const header = await readHeader();
    // The gate derives from the NAV table's inbox entry, so the poll's
    // audience can never drift from the row's audience.
    expect(header).toMatch(
      /const CONVERSATIONS_ROLES =\s*\n\s*NAV\.find\(\(item\) => item\.area === "inbox"\)\?\.roles \?\? \[\];/,
    );
    // Editors return before any request machinery is even built.
    expect(header).toMatch(
      /if \(!CONVERSATIONS_ROLES\.includes\(role\)\) \{\s*return;\s*\}/,
    );
    expect(header).toContain("fetch(\"/api/v1/needs-human\")");
  });

  it("renders the bell conditionally inside the shared mark, in the Needs-human green, with no count", async () => {
    const header = await readHeader();
    // The bell lives inside the inbox entry of the icon map, present only
    // while the signal says so — same SVG, same size, no layout shift, and
    // one identical treatment in the expanded rail, the icon rail, and the
    // drawer (all render SidebarChrome with this state).
    expect(header).toMatch(/const ICONS: Record<HeaderArea, \(needsHuman: boolean\) => ReactNode>/);
    const start = header.indexOf("inbox: (needsHuman) =>");
    const slice = header.slice(start, header.indexOf("</Mark>", start));
    expect(slice).toContain("{needsHuman ? NEEDS_HUMAN_BELL : null}");
    // The bell is the bright Needs-human green and nothing else.
    expect(header).toMatch(/const NEEDS_HUMAN_BELL = \(/);
    const bell = header.slice(header.indexOf("const NEEDS_HUMAN_BELL"), header.indexOf("</g>") + 4);
    expect(bell).toContain("styles.sideBellStroke");
    expect(bell).not.toMatch(/aria-label|needsHuman\.length|\d+ waiting/);
    // Presence is the message: the signal never turns into a rendered
    // count anywhere in the chrome.
    expect(header).not.toMatch(/needsHuman.{0,40}\.length/);
    // Both shells — the desktop rail and the mobile drawer — share the state.
    expect(header.match(/needsHuman=\{needsHuman\}/g)?.length).toBe(2);
    expect(header).toContain("const needsHuman = useNeedsHumanSignal(role);");
  });

  it("says needs human in the row's accessible name while the bell shows, and never announces the bell", async () => {
    const header = await readHeader();
    // The row's aria-label and the compact rail's callout share one wording,
    // resolved from one helper at call time.
    expect(header).toMatch(
      /function rowLabelFor\(item: \{ area: HeaderArea; label: string \}, needsHuman: boolean\): string \{\s*return item\.area === "inbox" && needsHuman \? `\$\{item\.label\} — needs human` : item\.label;/,
    );
    expect(header).toContain("const rowLabel = rowLabelFor(item, needsHuman);");
    expect(header).toContain("aria-label={rowLabel}");
    // The callout resolves the wording at display time through the live
    // ref, so a bell that appears or clears under a resting pointer
    // updates it in place.
    expect(header).toContain(
      "{...calloutProps(() => rowLabelFor(item, needsHumanRef.current))}",
    );
    expect(header).toContain("needsHumanRef.current = needsHuman;");
    expect(header).toMatch(/typeof callout\.label === "function" \? callout\.label\(\) : callout\.label/);
    // The bell renders inside the shared Mark SVG, which is aria-hidden.
    const markStart = header.indexOf("function Mark(");
    const mark = header.slice(markStart, header.indexOf("</svg>", markStart));
    expect(mark).toContain('aria-hidden="true"');
  });

  it("keeps the visible row label and the NAV table's shape (roles updated by ticket 102)", async () => {
    const header = await readHeader();
    // Only the Conversations row changes; the visible text stays the plain
    // label and every other nav row is untouched. Ticket 102 rewrote every
    // row's role list; this pin follows it.
    expect(header).toContain('{ area: "inbox", href: "/dashboard/inbox", label: "Conversations", roles: ["admin", "admissions_advisor"] }');
    expect(header).toContain('<span className={styles.sideLabel} aria-hidden="true">');
    expect(header).toContain("{item.label}");
  });
});
