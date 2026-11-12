import { beforeAll, describe, expect, it, vi } from "vitest";

// The PG-mode suite runs at the local cluster's connection ceiling: cap this
// file's pools so the whole suite's files keep their warmup budget.
process.env.PG_POOL_MAX = "2";
process.env.PG_AUTH_POOL_MAX = "2";
import {
  ask,
  startConversation,
  submitContact,
  TEST_ORIGIN,
  useTempDatabase,
  warmChatbotService,
  type ConversationStart,
} from "./helpers";
import { CookieJar, enrollTotp, provisionStaff, signInWithTotp } from "./auth-helpers";

/**
 * Ticket 73: conversations without a visitor-authored message — a
 * clear-created fresh successor, or a contact-form-only session — are
 * omitted from the staff desk's live lists until the first visitor
 * message, and a direct link to a clear-created successor redirects to
 * its closed predecessor's History transcript. The awaiting-staff and
 * claimed clear cases live in tests/conversation-clear.test.ts; this file
 * adds the bot-active clear, contact-form-only sessions, the direct-link
 * redirect, and the tab-label contract.
 */

const STAFF_EMAIL = "desk-helper@example.edu";
const STAFF_PASSWORD = "desk-helper-meadow-6t";

let staffTotp: Awaited<ReturnType<typeof enrollTotp>>;

// The direct-link test drives the real page component: capture redirect()
// instead of following it. headers() serves the staff session cookie.
let staffCookieValue = "";

/** Clear conversation the way the widget does: the live visitor credential. */
async function clearConversation(conversation: ConversationStart): Promise<Response> {
  const { POST } = await import("../src/app/api/v1/conversations/[id]/clear/route");
  return POST(
    new Request(`${TEST_ORIGIN}/api/v1/conversations/${conversation.id}/clear`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${conversation.token}`,
      },
    }),
    { params: Promise.resolve({ id: conversation.id }) },
  );
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound called");
  },
  redirect: (url: string) => {
    staffRedirect = url;
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: staffCookieValue }),
}));

let staffRedirect: string | null = null;

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await warmChatbotService();
  await provisionStaff({ email: STAFF_EMAIL, password: STAFF_PASSWORD, name: "Dee" });
  staffTotp = await enrollTotp(new CookieJar(), STAFF_EMAIL, STAFF_PASSWORD);
});

async function staffJar(): Promise<CookieJar> {
  const jar = new CookieJar();
  await signInWithTotp(jar, STAFF_EMAIL, STAFF_PASSWORD, staffTotp);
  return jar;
}

async function deskBody(jar: CookieJar): Promise<{
  incoming: { id: string }[];
  active: { id: string }[];
}> {
  const { GET } = await import("../src/app/api/staff/conversations/route");
  return (await (
    await GET(
      new Request(`${TEST_ORIGIN}/api/staff/conversations`, { headers: { cookie: jar.header() } }),
    )
  ).json()) as { incoming: { id: string }[]; active: { id: string }[] };
}

describe("empty conversations stay off the staff desk (ticket 73)", () => {
  it("omits a bot-active clear's successor until the visitor asks again", async () => {
    // A real bot-active chat: the visitor asked, the bot answered, then the
    // visitor cleared. The old chat leaves the desk; the fresh successor
    // must not appear as a blank row.
    const old = await startConversation();
    expect((await ask(old, "Ticket 73: what are the fees?")).status).toBe(200);

    const jar = await staffJar();
    const before = await deskBody(jar);
    expect(before.active.some((item) => item.id === old.id)).toBe(true);

    const response = await clearConversation(old);
    expect(response.status).toBe(200);
    const fresh = (await response.json()) as { id: string; token: string };

    const after = await deskBody(jar);
    expect(after.active.some((item) => item.id === old.id)).toBe(false);
    expect(after.active.some((item) => item.id === fresh.id)).toBe(false);

    // The successor's first visitor question makes it visible.
    expect((await submitContact({ id: fresh.id, token: fresh.token })).status).toBe(200);
    expect(
      (await ask({ id: fresh.id, token: fresh.token }, "Ticket 73: asking again.")).status,
    ).toBe(200);
    const visible = await deskBody(jar);
    expect(visible.active.some((item) => item.id === fresh.id)).toBe(true);
  });

  it("omits a contact-form-only session from Incoming and Active", async () => {
    // The gate accepted the details, but no question was ever asked.
    const session = await startConversation();
    expect((await submitContact(session)).status).toBe(200);

    const jar = await staffJar();
    const desk = await deskBody(jar);
    expect(desk.active.some((item) => item.id === session.id)).toBe(false);
    expect(desk.incoming.some((item) => item.id === session.id)).toBe(false);
  });

  it("redirects a direct link to an empty successor onto its predecessor", async () => {
    // Clear a real chat: the successor has no visitor message and the
    // predecessor carries the retained transcript.
    const old = await startConversation();
    expect((await ask(old, "Ticket 73: direct-link target question.")).status).toBe(200);
    const response = await clearConversation(old);
    expect(response.status).toBe(200);
    const fresh = (await response.json()) as { id: string; token: string };

    const jar = await staffJar();
    staffCookieValue = jar.header();
    const { default: DeskConversationPage } = await import(
      "../src/app/dashboard/inbox/[id]/page"
    );
    await expect(
      DeskConversationPage({ params: Promise.resolve({ id: fresh.id }) }),
    ).rejects.toThrow(`REDIRECT:/dashboard/inbox/${old.id}`);
    expect(staffRedirect).toBe(`/dashboard/inbox/${old.id}`);

    // An empty session without a predecessor keeps its direct-route
    // behavior: no redirect, the page resolves.
    const plain = await startConversation();
    await submitContact(plain);
    staffRedirect = null;
    const element = await DeskConversationPage({
      params: Promise.resolve({ id: plain.id }),
    });
    expect(element).toBeDefined();
    expect(staffRedirect).toBeNull();
  });

  it("finds predecessors through the store on both dialects", async () => {
    const old = await startConversation();
    expect((await ask(old, "Ticket 73: parity lookup question.")).status).toBe(200);
    const response = await clearConversation(old);
    const fresh = (await response.json()) as { id: string };

    const { getChatbotService } = await import("../src/db/service");
    const { store } = await getChatbotService();
    expect(await store.findPredecessorId(fresh.id)).toBe(old.id);
    expect(await store.findPredecessorId(old.id)).toBeNull();
  });
});

describe("the desk tabs read Active and History (ticket 73)", () => {
  it("renames only the first tab; the heading and sidebar keep Conversations", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { repoRoot } = await import("../src/paths");
    const desk = await fs.readFile(
      path.join(repoRoot(), "src/app/dashboard/inbox/conversation-desk.tsx"),
      "utf8",
    );
    // First tab Active, second History, both with their aria-current wiring.
    expect(desk).toMatch(/>\s*Active\s*</);
    expect(desk).toContain(">History</");
    expect(desk).toMatch(/aria-current=\{view === "active" \? "page" : undefined\}/);
    expect(desk).toMatch(/aria-current=\{view === "history" \? "page" : undefined\}/);
    // The page heading and the sidebar destination stay Conversations.
    expect(desk).toContain('title="Conversations"');
    const header = await fs.readFile(
      path.join(repoRoot(), "src/app/dashboard/header.tsx"),
      "utf8",
    );
    expect(header).toContain('label: "Conversations"');
  });
});
