import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/paths";
import { TEST_ORIGIN, useTempDatabase, warmChatbotService } from "./helpers";
import type { Conversation } from "../src/domain/types";

/**
 * Ticket 53: the Visitor emails page. The list derives live from
 * `conversations.visitor_email` — the store's page queries return only
 * conversations that carry an address, newest activity first, in page-size
 * windows; each conversation is one entry with its stored address, and a
 * purged conversation drops out with no extra bookkeeping. Since ticket 66
 * the address arrives with the required contact details at chat start. The page and the nav
 * entry are owner+staff (the roles that work handoffs), and the admin
 * conversation pane shows the address in its header meta, never inside the
 * transcript.
 */

const PAGE_PATH = "src/app/dashboard/emails/page.tsx";
const HEADER_PATH = "src/app/dashboard/header.tsx";
const DESK_PATH = "src/app/dashboard/inbox/conversation-desk.tsx";
const CSS_PATH = "src/app/dashboard/dashboard.module.css";

let seededNewestFirst: string[] = [];

function conversation(id: string, state: Conversation["state"], createdAt: string): Conversation {
  return {
    id,
    state,
    createdAt,
    claimedBy: null,
    claimedAt: null,
    visitorName: null,
    visitorEmail: null,
    visitorPhone: null,
    visitorLastSeenAt: null,
    closedAt: null,
    replacedBy: null,
    lastActivityAt: createdAt,
    attentionAt: null,
  };
}

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await warmChatbotService();
});

/** 13 conversations with an email (oldest first), 3 without one. */
async function seedConversations(): Promise<string[]> {
  const { getChatbotService } = await import("../src/db/service");
  const { store } = await getChatbotService();
  const base = Date.now();
  const newestFirst: string[] = [];
  for (let index = 0; index < 13; index += 1) {
    const id = crypto.randomUUID();
    const createdAt = new Date(base - 120_000).toISOString();
    // One closed conversation at the far end of the list gives the purge
    // test a real retention-shaped row to remove.
    await store.createConversation(conversation(id, index === 0 ? "closed" : "awaiting_staff", createdAt));
    await store.setConversationContact(id, {
      name: `Visitor ${String(index).padStart(2, "0")}`,
      email: `visitor${String(index).padStart(2, "0")}@example.edu`,
      phone: "555 010 0100",
    });
    await store.touchConversationActivity(
      id,
      new Date(base + index * 1_000).toISOString(),
      new Date(base + 86_400_000).toISOString(),
    );
    newestFirst.unshift(id);
  }
  for (let index = 0; index < 3; index += 1) {
    await store.createConversation(
      conversation(crypto.randomUUID(), "bot_active", new Date(base - index * 1_000).toISOString()),
    );
  }
  return newestFirst;
}

describe("the store's email page queries (ticket 53)", () => {
  beforeAll(async () => {
    seededNewestFirst = await seedConversations();
  });

  it("returns only conversations with an email, newest activity first", async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { store } = await getChatbotService();

    const pageOne = await store.listConversationsWithEmail(1, 10);
    expect(pageOne).toHaveLength(10);
    expect(pageOne.map((row) => row.id)).toEqual(seededNewestFirst.slice(0, 10));
    // Every row carries an address; the three email-less conversations
    // (and only they) are absent.
    for (const row of pageOne) {
      expect(row.visitorEmail).toBeTruthy();
    }
    expect(pageOne.map((row) => row.id)).not.toContain(seededNewestFirst[10] ?? "");
  });

  it("slices the list into page-size windows", async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { store } = await getChatbotService();

    const pageTwo = await store.listConversationsWithEmail(2, 10);
    expect(pageTwo.map((row) => row.id)).toEqual(seededNewestFirst.slice(10));

    // Past the end the window is simply empty — never an error.
    expect(await store.listConversationsWithEmail(3, 10)).toEqual([]);
  });

  it("counts every email-bearing conversation, not one page", async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { store } = await getChatbotService();

    expect(await store.countConversationsWithEmail()).toBe(13);
  });

  it("keeps one entry per conversation, carrying its stored contact email", async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { store } = await getChatbotService();
    const id = seededNewestFirst[0];
    if (!id) {
      throw new Error("the seed's newest conversation is missing");
    }

    // The list reads the column live: same single entry, the stored value.
    await store.setConversationContact(id, {
      name: "Latest Visitor",
      email: "latest@example.edu",
      phone: "555 010 0100",
    });
    const rows = await store.listConversationsWithEmail(1, 10);
    expect(await store.countConversationsWithEmail()).toBe(13);
    expect(rows.filter((row) => row.id === id)).toHaveLength(1);
    expect(rows.find((row) => row.id === id)?.visitorEmail).toBe("latest@example.edu");
  });

  it("drops a purged conversation's email entry out with it", async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { store } = await getChatbotService();
    // The seeded closed conversation sits at the list's far end.
    const purged = seededNewestFirst[seededNewestFirst.length - 1];
    if (!purged) {
      throw new Error("the seed's far-end conversation is missing");
    }

    const { historyQuietBefore } = await import("../src/domain/activity");
    expect(await store.purgeHistoryConversation(purged, historyQuietBefore())).toBe(true);
    expect(await store.countConversationsWithEmail()).toBe(12);
    const remaining = await store.listConversationsWithEmail(2, 10);
    expect(remaining.map((row) => row.id)).not.toContain(purged);
  });
});

describe("emails page resolution and pager window (ticket 53)", () => {
  it("falls back to page 1 on junk, zero, negative, and out-of-range values", async () => {
    const { resolveEmailsPage } = await import("../src/app/dashboard/emails/pagination");

    const canonical = resolveEmailsPage(undefined, 13);
    expect(canonical).toEqual({ page: 1, totalPages: 2 });
    // `page=1` and no parameter render the same first page.
    expect(resolveEmailsPage("1", 13)).toEqual(canonical);
    expect(resolveEmailsPage("2", 13).page).toBe(2);
    // Repeated query keys arrive as an array; the first value wins.
    expect(resolveEmailsPage(["2"], 13).page).toBe(2);

    // Digits only: hex and exponent forms are junk, not clever page numbers.
    for (const junk of ["abc", "0", "-2", "99", "", "2.5", "0x10", "1e1", undefined]) {
      expect(resolveEmailsPage(junk, 13).page, JSON.stringify(junk)).toBe(1);
    }
  });

  it("windows the numbered links around the current page with gaps", async () => {
    const { emailsPageLinks } = await import("../src/app/dashboard/emails/pagination");

    // Small totals list every page with no gaps.
    expect(emailsPageLinks(2, 3)).toEqual([
      { kind: "page", page: 1 },
      { kind: "page", page: 2 },
      { kind: "page", page: 3 },
    ]);

    const windowed = emailsPageLinks(5, 20);
    expect(windowed).toEqual([
      { kind: "page", page: 1 },
      { kind: "gap" },
      { kind: "page", page: 4 },
      { kind: "page", page: 5 },
      { kind: "page", page: 6 },
      { kind: "gap" },
      { kind: "page", page: 20 },
    ]);

    // The first and last pages never grow a leading or trailing gap.
    expect(emailsPageLinks(1, 20)[0]).toEqual({ kind: "page", page: 1 });
    expect(emailsPageLinks(20, 20).at(-1)).toEqual({ kind: "page", page: 20 });
  });
});

describe("the Visitor emails page (ticket 53)", () => {
  it("resolves the URL parameter server-side with the page queries", async () => {
    const source = await readFile(path.join(repoRoot(), PAGE_PATH), "utf8");

    // Next 16 server-component convention: searchParams arrives as a Promise.
    expect(source).toContain("searchParams: Promise<");
    expect(source).toContain("await searchParams");
    // The page fetches the count for the pager and only the page's rows.
    expect(source).toContain("countConversationsWithEmail()");
    expect(source).toContain("listConversationsWithEmail(");

    // Real links, aria-current on the live page, dead links impossible.
    expect(source).toContain('aria-current={link.page === page ? "page" : undefined}');
    expect(source).toContain("page > 1");
    expect(source).toContain("page < totalPages");
    expect(source).toContain("/dashboard/emails?page=");
  });

  it("is gated to the handoff roles and renders rows as whole links", async () => {
    const source = await readFile(path.join(repoRoot(), PAGE_PATH), "utf8");

    // Same role rules as the nav item: requireStaff with owner + staff.
    expect(source).toContain("requireStaff");
    expect(source).toContain("STAFF_ROLES");

    // The row is one link to the conversation, showing the address as text —
    // no mailto inside the row link.
    expect(source).toContain('href={`/dashboard/inbox/${conversation.id}`}');
    expect(source).toContain("{conversation.visitorEmail}");
    expect(source).not.toContain("mailto:");

    // The copy states the required capture on every new chat (ticket 66);
    // the empty state explains when entries appear, and no pager renders
    // with it.
    expect(source).toContain("Every new chat starts with the visitor&apos;s name, email");
    expect(source).toContain("total === 0");
    expect(source).toContain("No visitor emails yet");
    expect(source).toContain("shares their contact");
    expect(source).not.toContain("asks for a human and");
  });

  it("joins the shared nav list for owners and staff", async () => {
    const header = await readFile(path.join(repoRoot(), HEADER_PATH), "utf8");

    // One more entry in the shared NAV list — never separate chrome.
    expect(header).toContain(
      '{ area: "emails", href: "/dashboard/emails", label: "Visitor emails", roles: ["owner", "staff"] }',
    );
    // The sidebar shell's icon record covers the new area (envelope mark).
    expect(header).toContain("emails: (");
  });

  it("shows the follow-up email in the pane header, never the transcript", async () => {
    const desk = await readFile(path.join(repoRoot(), DESK_PATH), "utf8");

    expect(desk).toContain('<strong>Follow-up email</strong> {selected.visitorEmail}');
    expect(desk).toContain("styles.paneEmail");
    // The email line sits in the pane's header block, before the transcript
    // renders — it must never read as a message.
    const headerAt = desk.indexOf("styles.paneEmail");
    const transcriptAt = desk.indexOf('className={styles.transcript}');
    expect(headerAt).toBeGreaterThan(-1);
    expect(transcriptAt).toBeGreaterThan(headerAt);
  });

  it("styles the list rows and the pane email line", async () => {
    const css = await readFile(path.join(repoRoot(), CSS_PATH), "utf8");
    for (const className of [".emailList", ".emailRow", ".emailAddress", ".emailRowMeta", ".paneEmail"]) {
      expect(css, className).toContain(className);
    }
  });
});
