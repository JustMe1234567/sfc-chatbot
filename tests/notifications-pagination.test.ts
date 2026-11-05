import { beforeAll, describe, expect, it } from "vitest";
import { TEST_ORIGIN, useTempDatabase, warmChatbotService } from "./helpers";

/**
 * Ticket 50: the Delivery history list is paginated — ten rows per page,
 * URL-driven through the `page` search parameter, with the data layer
 * fetching only a page's rows plus a total count. The staff notifications
 * API stays unpaginated: it feeds the retry client, not the page.
 */
const PAGE_PATH = "src/app/dashboard/notifications/page.tsx";
const CSS = "src/app/dashboard/dashboard.module.css";

let seededNewestFirst: string[] = [];

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await warmChatbotService();
});

/** 23 notifications over 23 throwaway conversations, oldest inserted first. */
async function seedNotifications(): Promise<string[]> {
  const { getChatbotService } = await import("../src/db/service");
  const { db } = await getChatbotService();
  const base = Date.now();
  const newestFirst: string[] = [];
  for (let index = 0; index < 23; index += 1) {
    const conversationId = crypto.randomUUID();
    await db.run(
      "INSERT INTO conversations (id, state, created_at) VALUES (?, 'closed', ?)",
      conversationId,
      new Date(base - 60_000).toISOString(),
    );
    const status = index % 4 === 0 ? "failed" : index % 4 === 1 ? "pending" : "sent";
    const createdAt = new Date(base + index * 1_000).toISOString();
    await db.run(
      `INSERT INTO notifications (id, type, conversation_id, recipients, status, attempts, created_at)
       VALUES (?, 'escalation_alert', ?, ?, ?, 1, ?)`,
      crypto.randomUUID(),
      conversationId,
      JSON.stringify(["front-desk@example.edu"]),
      status,
      createdAt,
    );
    newestFirst.unshift(conversationId);
  }
  return newestFirst;
}

describe("the notification page query (ticket 50)", () => {
  beforeAll(async () => {
    seededNewestFirst = await seedNotifications();
  });

  it("fetches only the page's rows, newest first", async () => {
    const { listNotificationPage, NOTIFICATIONS_PAGE_SIZE } = await import(
      "../src/mail/notifications"
    );
    const { getChatbotService } = await import("../src/db/service");
    const { db } = await getChatbotService();

    expect(NOTIFICATIONS_PAGE_SIZE).toBe(10);

    const first = await listNotificationPage(db, 1);
    expect(first).toHaveLength(10);
    // Page 1 always carries the newest attempts.
    expect(first.map((row) => row.conversationId).slice(0, 3)).toEqual(
      seededNewestFirst.slice(0, 3),
    );

    const second = await listNotificationPage(db, 2);
    expect(second).toHaveLength(10);
    expect(second[0]?.conversationId).toBe(seededNewestFirst[10]);

    const third = await listNotificationPage(db, 3);
    expect(third).toHaveLength(3);
    expect(third[2]?.conversationId).toBe(seededNewestFirst[22]);
  });

  it("counts statuses across every notification, not one page", async () => {
    const { notificationStatusCounts } = await import("../src/mail/notifications");
    const { getChatbotService } = await import("../src/db/service");
    const { db } = await getChatbotService();

    const counts = await notificationStatusCounts(db);
    expect(counts.total).toBe(23);
    // The seed loop: failed when index % 4 === 0 (6 rows), pending when
    // === 1 (6 rows), sent for the other 11.
    expect(counts.delivered).toBe(11);
    expect(counts.failed).toBe(6);
  });
});

describe("page resolution and the pager window (ticket 50)", () => {
  it("falls back to page 1 on junk, zero, negative, and out-of-range values", async () => {
    const { resolveNotificationPage } = await import(
      "../src/app/dashboard/notifications/pagination"
    );

    const canonical = resolveNotificationPage(undefined, 23);
    expect(canonical).toEqual({ page: 1, totalPages: 3 });
    // `page=1` and no parameter render the same first page.
    expect(resolveNotificationPage("1", 23)).toEqual(canonical);

    expect(resolveNotificationPage("2", 23)).toEqual({ page: 2, totalPages: 3 });
    // Repeated query keys arrive as an array; the first value wins.
    expect(resolveNotificationPage(["2"], 23).page).toBe(2);

    // Digits only: hex and exponent forms are junk, not clever page numbers.
    for (const junk of ["abc", "0", "-2", "99", "", "2.5", "0x10", "1e1", undefined]) {
      expect(resolveNotificationPage(junk, 23).page, JSON.stringify(junk)).toBe(1);
    }
  });

  it("windows the numbered links around the current page with gaps", async () => {
    const { notificationPageLinks } = await import(
      "../src/app/dashboard/notifications/pagination"
    );

    // Small totals list every page with no gaps.
    expect(notificationPageLinks(2, 3)).toEqual([
      { kind: "page", page: 1 },
      { kind: "page", page: 2 },
      { kind: "page", page: 3 },
    ]);

    const windowed = notificationPageLinks(5, 20);
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
    expect(notificationPageLinks(1, 20)[0]).toEqual({ kind: "page", page: 1 });
    expect(notificationPageLinks(20, 20).at(-1)).toEqual({ kind: "page", page: 20 });
  });
});

describe("the notifications page stays a server component on the page param", () => {
  it("resolves the URL parameter server-side and renders from the page query", async () => {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const { repoRoot } = await import("../src/paths");
    const source = await readFile(path.join(repoRoot(), PAGE_PATH), "utf8");

    // Next 16 server-component convention: searchParams arrives as a Promise.
    expect(source).toContain("searchParams: Promise<");
    expect(source).toContain("await searchParams");
    expect(source).toContain("listNotificationPage(");
    expect(source).toContain("notificationStatusCounts(");
    // The page itself never reads the whole table.
    expect(source).not.toContain("listNotifications(db)");

    // Summary badges count everything; the empty state keys on the total.
    expect(source).toContain("counts.delivered");
    expect(source).toContain("counts.failed");
    expect(source).toContain("total === 0");

    // Real links, aria-current on the live page, dead links impossible.
    expect(source).toContain('aria-current={link.page === page ? "page" : undefined}');
    expect(source).toContain("page > 1");
    expect(source).toContain("page < totalPages");
    expect(source).toContain("/dashboard/notifications?page=");
  });

  it("keeps the staff notifications API unpaginated for the retry client", async () => {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const { repoRoot } = await import("../src/paths");
    const route = await readFile(
      path.join(repoRoot(), "src/app/api/staff/notifications/route.ts"),
      "utf8",
    );
    expect(route).toContain("listNotifications(db)");
  });

  it("gives pager links a 44px touch floor with a distinct current page", async () => {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const { repoRoot } = await import("../src/paths");
    const css = await readFile(path.join(repoRoot(), CSS), "utf8");
    expect(css).toMatch(/\.pagerLink \{[^}]*min-height: 44px/s);
    expect(css).toMatch(/\.pagerLink\[aria-current="page"\]/);
    expect(css).toMatch(/\.pager \{[^}]*flex-wrap: wrap/s);
  });
});
