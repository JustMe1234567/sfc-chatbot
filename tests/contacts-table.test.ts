// Postgres-mode files must not multiply at the cluster's connection ceiling.
process.env.PG_POOL_MAX = process.env.PG_POOL_MAX ?? "2";

import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/paths";
import type { Conversation } from "../src/domain/types";
import {
  CONTACTS_PAGE_SIZE,
  contactsListOptions,
  defaultContactSortDirection,
  resolveContactsView,
} from "../src/app/dashboard/contacts/pagination";
import { TEST_ORIGIN, useTempDatabase, warmChatbotService } from "./helpers";

beforeAll(async () => {
  // The staff page's PUT-free reads never hit the origin guard, but the
  // house pattern sets the base URL before any service warms.
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  useTempDatabase();
  await warmChatbotService();
});

function conversation(
  id: string,
  createdAt: string,
  contact: { name: string; email: string; phone: string },
): Conversation {
  return {
    id,
    state: "awaiting_staff",
    createdAt,
    claimedBy: null,
    claimedAt: null,
    visitorName: contact.name,
    visitorEmail: contact.email,
    visitorPhone: contact.phone,
    visitorLastSeenAt: null,
    closedAt: null,
    replacedBy: null,
    lastActivityAt: createdAt,
    attentionAt: null,
  };
}

interface SeededContact {
  id: string;
  name: string;
  email: string;
  phone: string;
  medium: "chat" | "email" | "phone";
  requestedAt: string;
}

/**
 * A deterministic spread for the sort and search rules: five contacts whose
 * request times differ, one conversation with two requests (the latest
 * pairs medium + time), and one conversation without any request (never a
 * saved contact). Names and emails share lowercase/uppercase variants so
 * case-insensitivity has something to prove.
 */
async function seedContacts(): Promise<SeededContact[]> {
  const { getChatbotService } = await import("../src/db/service");
  const { store } = await getChatbotService();
  const base = Date.parse("2026-11-13T09:00:00.000Z");
  const planned: SeededContact[] = [
    { id: "c-alpha", name: "Alice Anderson", email: "alice@example.edu", phone: "555 010 0001", medium: "email", requestedAt: new Date(base + 1_000).toISOString() },
    { id: "c-bravo", name: "bravo brown", email: "Bravo@Example.edu", phone: "555 010 0002", medium: "phone", requestedAt: new Date(base + 2_000).toISOString() },
    { id: "c-charlie", name: "Charlie Chen", email: "charlie@example.edu", phone: "555 010 0003", medium: "chat", requestedAt: new Date(base + 3_000).toISOString() },
    { id: "c-delta", name: "Delta Davis", email: "delta@example.edu", phone: "555 010 0004", medium: "email", requestedAt: new Date(base + 4_000).toISOString() },
    { id: "c-echo", name: "Echo Emu", email: "echo@example.edu", phone: "555 010 100%_special", medium: "phone", requestedAt: new Date(base + 5_000).toISOString() },
  ];
  for (const entry of planned) {
    await store.createConversation(
      conversation(entry.id, new Date(base).toISOString(), {
        name: entry.name,
        email: entry.email,
        phone: entry.phone,
      }),
    );
    await store.createContactRequest({
      id: `req-${entry.id}`,
      conversationId: entry.id,
      medium: entry.medium,
      status: "open",
      createdAt: entry.requestedAt,
      completedAt: null,
      completedBy: null,
    });
  }
  // The pairing proof: bravo's earlier chat request is superseded by the
  // planned phone request above — the row's medium and time must come from
  // that same later request. Insert the superseded one first.
  await store.createContactRequest({
    id: "req-c-bravo-early",
    conversationId: "c-bravo",
    medium: "chat",
    status: "completed",
    createdAt: new Date(base + 1_500).toISOString(),
    completedAt: new Date(base + 1_800).toISOString(),
    completedBy: "staff-1",
  });
  // A request-less conversation never appears.
  await store.createConversation(
    conversation("c-none", new Date(base).toISOString(), {
      name: "Nobody Nomad",
      email: "nobody@example.edu",
      phone: "555 010 0000",
    }),
  );
  return planned;
}

describe("the contacts list store queries (ticket 74)", () => {
  let seeded: SeededContact[];

  beforeAll(async () => {
    await warmChatbotService();
    seeded = await seedContacts();
  });

  it("defaults to Date requested descending with derived tie-breaks", async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { store } = await getChatbotService();

    const rows = await store.listConversationsWithContactRequest(1, 10, {
      sort: "requested",
      direction: "desc",
    });
    expect(rows.map((row) => row.conversation.id)).toEqual([
      "c-echo",
      "c-delta",
      "c-charlie",
      "c-bravo",
      "c-alpha",
    ]);
    // Every row pairs its latest request's time with the same request's
    // medium — bravo's earlier chat request must not leak its medium here.
    const bravo = rows.find((row) => row.conversation.id === "c-bravo");
    expect(bravo?.medium).toBe("phone");
    expect(bravo?.requestedAt).toBe(new Date(Date.parse("2026-11-13T09:00:00.000Z") + 2_000).toISOString());
    expect(await store.countConversationsWithContactRequest()).toBe(5);
  });

  it("sorts every displayed column in both directions", async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { store } = await getChatbotService();
    const ids = async (
      sort: "name" | "email" | "phone" | "medium" | "requested",
      direction: "asc" | "desc",
    ) =>
      (
        await store.listConversationsWithContactRequest(1, 10, {
          sort,
          direction,
        })
      ).map((row) => row.conversation.id);

    // Name ascending puts lowercase "bravo" after the capitalized names —
    // lower() folds the comparison, so alphabetical order holds regardless
    // of stored case.
    expect(await ids("name", "asc")).toEqual([
      "c-alpha",
      "c-bravo",
      "c-charlie",
      "c-delta",
      "c-echo",
    ]);
    expect((await ids("name", "desc")).at(-1)).toBe("c-alpha");
    expect(await ids("email", "asc")).toEqual([
      "c-alpha",
      "c-bravo",
      "c-charlie",
      "c-delta",
      "c-echo",
    ]);
    // Phone descending is reverse-numeric-string order: echo's 1-prefix
    // sorts above the 0-prefix numbers.
    expect(await ids("phone", "desc")).toEqual([
      "c-echo",
      "c-delta",
      "c-charlie",
      "c-bravo",
      "c-alpha",
    ]);
    // Medium ascending is alphabetical over the displayed label value;
    // equal media fall to the conversation-id descending tie-break
    // (delta before alpha, echo before bravo).
    expect(await ids("medium", "asc")).toEqual([
      "c-charlie",
      "c-delta",
      "c-alpha",
      "c-echo",
      "c-bravo",
    ]);
    // Date requested ascending reverses the default.
    expect((await ids("requested", "asc")).at(-1)).toBe("c-echo");
  });

  it("searches case-insensitively across name, email, and phone", async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { store } = await getChatbotService();

    const byName = await store.listConversationsWithContactRequest(1, 10, {
      query: "ALICE",
      sort: "requested",
      direction: "desc",
    });
    expect(byName.map((row) => row.conversation.id)).toEqual(["c-alpha"]);

    const byEmail = await store.listConversationsWithContactRequest(1, 10, {
      query: "bravo@example.edu",
      sort: "requested",
      direction: "desc",
    });
    expect(byEmail.map((row) => row.conversation.id)).toEqual(["c-bravo"]);

    const byPhone = await store.listConversationsWithContactRequest(1, 10, {
      query: "0003",
      sort: "requested",
      direction: "desc",
    });
    expect(byPhone.map((row) => row.conversation.id)).toEqual(["c-charlie"]);

    // The count describes the whole matching set, not a page.
    expect(await store.countConversationsWithContactRequest({ query: "000" })).toBe(4);
    expect(await store.countConversationsWithContactRequest({ query: "bravo@EXAMPLE.EDU" })).toBe(1);
  });

  it("treats LIKE wildcards in the query as literal text", async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { store } = await getChatbotService();

    // Echo's phone contains % and _: an unescaped pattern would match every
    // row; the escaped one matches only echo.
    const rows = await store.listConversationsWithContactRequest(1, 10, {
      query: "100%_special",
      sort: "requested",
      direction: "desc",
    });
    expect(rows.map((row) => row.conversation.id)).toEqual(["c-echo"]);
    expect(await store.countConversationsWithContactRequest({ query: "100%_special" })).toBe(1);
  });

  it("breaks equal request timestamps deterministically by conversation id", async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { store } = await getChatbotService();
    // Two contacts whose latest requests land on the same instant (before
    // the seed's, so they sort last under the default): the id descending
    // tie-break fixes their order — and repeats identically, so page
    // boundaries never shuffle.
    const instant = new Date(Date.parse("2026-11-13T09:00:00.000Z") + 500).toISOString();
    for (const suffix of ["tie-a", "tie-b", "tie-c"]) {
      const id = `c-${suffix}`;
      await store.createConversation(
        conversation(id, instant, {
          name: `Tie ${suffix}`,
          email: `${suffix}@example.edu`,
          phone: "555 010 9999",
        }),
      );
      await store.createContactRequest({
        id: `req-${id}`,
        conversationId: id,
        medium: "email",
        status: "open",
        createdAt: instant,
        completedAt: null,
        completedBy: null,
      });
    }
    const first = (
      await store.listConversationsWithContactRequest(1, 10, {
        sort: "requested",
        direction: "desc",
      })
    )
      .filter((row) => row.requestedAt === instant)
      .map((row) => row.conversation.id);
    expect(first).toEqual(["c-tie-c", "c-tie-b", "c-tie-a"]);
    const second = (
      await store.listConversationsWithContactRequest(1, 10, {
        sort: "requested",
        direction: "desc",
      })
    )
      .filter((row) => row.requestedAt === instant)
      .map((row) => row.conversation.id);
    expect(second).toEqual(first);
  });

  it("paginates the sorted and filtered set", async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { store } = await getChatbotService();

    const pageOne = await store.listConversationsWithContactRequest(1, 2, {
      sort: "requested",
      direction: "desc",
    });
    const pageTwo = await store.listConversationsWithContactRequest(2, 2, {
      sort: "requested",
      direction: "desc",
    });
    expect(pageOne.map((row) => row.conversation.id)).toEqual(["c-echo", "c-delta"]);
    expect(pageTwo.map((row) => row.conversation.id)).toEqual(["c-charlie", "c-bravo"]);

    // Search applies before pagination: the filtered set has its own pages.
    // Echo's phone carries no "000", so the matching set is the other four.
    const filteredPageOne = await store.listConversationsWithContactRequest(1, 2, {
      query: "000",
      sort: "requested",
      direction: "desc",
    });
    expect(filteredPageOne.map((row) => row.conversation.id)).toEqual(["c-delta", "c-charlie"]);
    expect(await store.countConversationsWithContactRequest({ query: "000" })).toBe(4);
  });
});

describe("the contacts view resolution (ticket 74)", () => {
  it("falls back safely on missing and invalid URL values", () => {
    expect(resolveContactsView({})).toEqual({
      query: "",
      sort: "requested",
      direction: "desc",
    });
    expect(resolveContactsView({ q: "  padded  " })).toEqual({
      query: "padded",
      sort: "requested",
      direction: "desc",
    });
    // Array-valued params (repeated keys) take the first value.
    expect(resolveContactsView({ sort: ["name", "phone"], dir: ["asc"] })).toEqual({
      query: "",
      sort: "name",
      direction: "asc",
    });
    for (const junk of ["namen", "email ", "", undefined]) {
      expect(resolveContactsView({ sort: junk }).sort, JSON.stringify(junk)).toBe("requested");
    }
    // A valid column with a junk direction lands on that column's default.
    expect(resolveContactsView({ sort: "name", dir: "down" })).toEqual({
      query: "",
      sort: "name",
      direction: "asc",
    });
    expect(resolveContactsView({ sort: "requested", dir: "up" })).toEqual({
      query: "",
      sort: "requested",
      direction: "desc",
    });
  });

  it("maps directions per column and keeps empty queries out of the options", () => {
    expect(defaultContactSortDirection("requested")).toBe("desc");
    expect(defaultContactSortDirection("name")).toBe("asc");
    expect(contactsListOptions({ query: "", sort: "requested", direction: "desc" })).toEqual({
      sort: "requested",
      direction: "desc",
    });
    expect(contactsListOptions({ query: "smith", sort: "email", direction: "desc" })).toEqual({
      query: "smith",
      sort: "email",
      direction: "desc",
    });
    expect(CONTACTS_PAGE_SIZE).toBe(10);
  });
});

describe("the contacts page contract (ticket 74)", () => {
  it("renders one visible reference heading and suppresses the header title here only", async () => {
    const source = await readFile(
      path.join(repoRoot(), "src/app/dashboard/contacts/page.tsx"),
      "utf8",
    );
    const header = await readFile(
      path.join(repoRoot(), "src/app/dashboard/header.tsx"),
      "utf8",
    );

    expect(source).toContain("hideTitle");
    expect(source).toContain('aria-labelledby="contacts-title"');
    expect(source).toContain("Follow-up contacts");
    // The header's opt-in flag is what hides the title; other routes do not
    // pass it, so their visible headings are unchanged.
    expect(header).toContain("hideTitle = false");
    expect(header).toContain("styles.srOnly : styles.contentTitle");
  });

  it("exposes accessible search and sort controls over semantic tables", async () => {
    const source = await readFile(
      path.join(repoRoot(), "src/app/dashboard/contacts/page.tsx"),
      "utf8",
    );

    // The search input keeps a persistent accessible label, not just a
    // placeholder, and the pager/pill describe the filtered set.
    expect(source).toContain('aria-label="Search contacts"');
    expect(source).toContain('role="search"');
    expect(source).toContain('aria-sort=');
    expect(source).toContain('scope="col"');
    // The count pill's copy distinguishes saved vs matching and both
    // singular forms.
    expect(source).toContain("1 matching contact");
    expect(source).toContain("1 saved contact");
    expect(source).toContain("matching contacts");
    expect(source).toContain("saved contacts");
    // Distinct empty states.
    expect(source).toContain("No saved contacts yet");
    expect(source).toContain("No contacts match your search");
    // Rows keep a real link per conversation (never pointer-only rows).
    expect(source).toContain('href={`/dashboard/inbox/${conversation.id}`}');
    // The pager and sort links preserve the current search and sort.
    expect(source).toContain('name="sort"');
    expect(source).toContain('name="dir"');
    expect(source).toContain("Clear the search");
  });

  it("restacks the table as labeled cards on phones through the shared CSS", async () => {
    const css = await readFile(
      path.join(repoRoot(), "src/app/dashboard/dashboard.module.css"),
      "utf8",
    );
    // The card labels come from the data-label attributes the page sets.
    const source = await readFile(
      path.join(repoRoot(), "src/app/dashboard/contacts/page.tsx"),
      "utf8",
    );
    for (const label of ['data-label="Name"', 'data-label="Email"', 'data-label="Phone"', 'data-label="Medium"', 'data-label="Date requested"']) {
      expect(source, label).toContain(label);
    }
    // The phone breakpoint hides the header row and shows the labels.
    expect(css).toMatch(/\.contactsTable thead \{[^}]*display: none/s);
    expect(css).toContain("content: attr(data-label)");
    expect(css).not.toMatch(/\.contactsTableWrap \{[^}]*overflow-x: scroll/s);
  });

  it("drops the default link underline on the sort headers and row link (ticket 75)", async () => {
    const css = await readFile(
      path.join(repoRoot(), "src/app/dashboard/dashboard.module.css"),
      "utf8",
    );
    // The removal lives on the two ticket-74 link rules themselves, like
    // every other dashboard link style — no global or page-wide reset.
    expect(css).toMatch(/\.contactsSort \{[^}]*text-decoration: none/s);
    expect(css).toMatch(/\.contactsRowLink \{[^}]*text-decoration: none/s);
  });
});
