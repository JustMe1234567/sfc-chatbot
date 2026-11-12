import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/paths";
import { TEST_ORIGIN, useTempDatabase, warmChatbotService } from "./helpers";
import type { Conversation } from "../src/domain/types";

/**
 * Ticket 69: the Visitor contacts page (renamed from Visitor emails, ticket
 * 53). The list derives live from the contact_requests table — only
 * conversations whose visitor created at least one request are saved
 * contacts; the temporary chat-start details alone never appear. Each row
 * carries the conversation's latest requested medium, and the store's page
 * queries return page-size windows newest activity first; a purged
 * conversation drops out with no extra bookkeeping. The page and the nav
 * entry are owner+staff (the roles that work follow-ups).
 */

const PAGE_PATH = "src/app/dashboard/contacts/page.tsx";
const HEADER_PATH = "src/app/dashboard/header.tsx";

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

/** 13 conversations with a contact request (oldest first), 3 without one. */
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
    await store.createConversation(
      conversation(id, index === 0 ? "closed" : "awaiting_staff", createdAt),
    );
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
    await store.createContactRequest({
      id: crypto.randomUUID(),
      conversationId: id,
      // Every third conversation's latest medium is phone or chat; the rest
      // email — the row shows whichever request came last.
      medium: index % 3 === 0 ? "email" : index % 3 === 1 ? "phone" : "chat",
      status: "open",
      createdAt: new Date(base + index * 1_000).toISOString(),
      completedAt: null,
      completedBy: null,
    });
    newestFirst.unshift(id);
  }
  for (let index = 0; index < 3; index += 1) {
    await store.createConversation(
      conversation(crypto.randomUUID(), "bot_active", new Date(base - index * 1_000).toISOString()),
    );
  }
  return newestFirst;
}

describe("the store's contact-request page queries (ticket 69)", () => {
  beforeAll(async () => {
    seededNewestFirst = await seedConversations();
  });

  it("returns only conversations with a contact request, newest activity first", async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { store } = await getChatbotService();

    const pageOne = await store.listConversationsWithContactRequest(1, 10);
    expect(pageOne).toHaveLength(10);
    expect(pageOne.map((row) => row.conversation.id)).toEqual(seededNewestFirst.slice(0, 10));
    // Every row carries its latest medium; the three request-less
    // conversations (and only they) are absent.
    for (const row of pageOne) {
      expect(row.medium).toBeTruthy();
    }
    expect(pageOne.map((row) => row.conversation.id)).not.toContain(seededNewestFirst[10] ?? "");
  });

  it("slices the list into page-size windows", async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { store } = await getChatbotService();

    const pageTwo = await store.listConversationsWithContactRequest(2, 10);
    expect(pageTwo.map((row) => row.conversation.id)).toEqual(seededNewestFirst.slice(10));

    // Past the end the window is simply empty — never an error.
    expect(await store.listConversationsWithContactRequest(3, 10)).toEqual([]);
  });

  it("counts every conversation with a request, not one page", async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { store } = await getChatbotService();

    expect(await store.countConversationsWithContactRequest()).toBe(13);
  });

  it("keeps one row per conversation showing the latest requested medium", async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { store } = await getChatbotService();
    const id = seededNewestFirst[0];
    if (!id) {
      throw new Error("the seed's newest conversation is missing");
    }

    // A second request — allowed once none is open — moves the row's medium.
    // Its instant must postdate the seed's newest request (the seed writes
    // base + index seconds, so jump well past it).
    await store.completeOpenContactRequest(id, "staff-1", new Date().toISOString());
    await store.createContactRequest({
      id: crypto.randomUUID(),
      conversationId: id,
      medium: "phone",
      status: "open",
      createdAt: new Date(Date.now() + 120_000).toISOString(),
      completedAt: null,
      completedBy: null,
    });
    const rows = await store.listConversationsWithContactRequest(1, 10);
    expect(await store.countConversationsWithContactRequest()).toBe(13);
    // Exactly one row for the conversation, showing the latest medium.
    expect(rows.filter((entry) => entry.conversation.id === id)).toHaveLength(1);
    expect(rows.find((entry) => entry.conversation.id === id)?.medium).toBe("phone");
    // The earlier request event stays in the conversation's history.
    expect(await store.listContactRequests(id)).toHaveLength(2);
  });

  it("drops a purged conversation's saved contact out with it", async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { store } = await getChatbotService();
    // The seeded closed conversation sits at the list's far end.
    const purged = seededNewestFirst[seededNewestFirst.length - 1];
    if (!purged) {
      throw new Error("the seed's far-end conversation is missing");
    }

    const { historyQuietBefore } = await import("../src/domain/activity");
    expect(await store.purgeHistoryConversation(purged, historyQuietBefore())).toBe(true);
    expect(await store.countConversationsWithContactRequest()).toBe(12);
    const remaining = await store.listConversationsWithContactRequest(2, 10);
    expect(remaining.map((row) => row.conversation.id)).not.toContain(purged);
  });
});

describe("contacts page resolution and pager window (ticket 69)", () => {
  it("falls back to page 1 on junk, zero, negative, and out-of-range values", async () => {
    const { resolveContactsPage } = await import("../src/app/dashboard/contacts/pagination");

    const canonical = resolveContactsPage(undefined, 13);
    expect(canonical).toEqual({ page: 1, totalPages: 2 });
    // `page=1` and no parameter render the same first page.
    expect(resolveContactsPage("1", 13)).toEqual(canonical);
    expect(resolveContactsPage("2", 13).page).toBe(2);
    // Repeated query keys arrive as an array; the first value wins.
    expect(resolveContactsPage(["2"], 13).page).toBe(2);

    // Digits only: hex and exponent forms are junk, not clever page numbers.
    for (const junk of ["abc", "0", "-2", "99", "", "2.5", "0x10", "1e1", undefined]) {
      expect(resolveContactsPage(junk, 13).page, JSON.stringify(junk)).toBe(1);
    }
  });

  it("windows the numbered links around the current page with gaps", async () => {
    const { contactsPageLinks } = await import("../src/app/dashboard/contacts/pagination");

    // Small totals list every page with no gaps.
    expect(contactsPageLinks(2, 3)).toEqual([
      { kind: "page", page: 1 },
      { kind: "page", page: 2 },
      { kind: "page", page: 3 },
    ]);

    const windowed = contactsPageLinks(5, 20);
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
    expect(contactsPageLinks(1, 20)[0]).toEqual({ kind: "page", page: 1 });
    expect(contactsPageLinks(20, 20).at(-1)).toEqual({ kind: "page", page: 20 });
  });
});

describe("the Visitor contacts page (ticket 69)", () => {
  it("resolves the URL parameter server-side with the page queries", async () => {
    const source = await readFile(path.join(repoRoot(), PAGE_PATH), "utf8");

    // Next 16 server-component convention: searchParams arrives as a Promise.
    expect(source).toContain("searchParams: Promise<");
    expect(source).toContain("await searchParams");
    // The page fetches the filtered count for the pill and pager and only
    // the page's rows (ticket 74 passes the resolved search and sort).
    expect(source).toContain("countConversationsWithContactRequest(options)");
    expect(source).toContain("listConversationsWithContactRequest(");

    // Real links, aria-current on the live page, dead links impossible.
    expect(source).toContain('aria-current={link.page === page ? "page" : undefined}');
    expect(source).toContain("page > 1");
    expect(source).toContain("page < totalPages");
  });

  it("is gated to the follow-up roles and renders rows as whole links", async () => {
    const source = await readFile(path.join(repoRoot(), PAGE_PATH), "utf8");

    // Same role rules as the nav item: requireStaff with owner + staff.
    expect(source).toContain("requireStaff");
    expect(source).toContain("STAFF_ROLES");

    // Each row links to its conversation and shows the saved contact's
    // name, email, phone, latest medium, and the latest request's time
    // (ticket 74's Date requested — not the chat-start time, ticket 69's
    // label, superseded by the reference).
    expect(source).toContain('href={`/dashboard/inbox/${conversation.id}`}');
    expect(source).toContain("conversation.visitorEmail");
    expect(source).toContain("conversation.visitorPhone");
    expect(source).toContain("conversation.visitorName");
    expect(source).toContain("requestedAt");
    expect(source).not.toContain("mailto:");
  });

  it("joins the shared nav list for owners and staff under its new name", async () => {
    const header = await readFile(path.join(repoRoot(), HEADER_PATH), "utf8");

    expect(header).toContain(
      '{ area: "contacts", href: "/dashboard/contacts", label: "Visitor contacts", roles: ["owner", "staff"] }',
    );
    expect(header).toContain("contacts: (");
    expect(header).not.toContain('"/dashboard/emails"');
  });
});
