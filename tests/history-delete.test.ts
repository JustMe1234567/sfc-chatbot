import { beforeAll, describe, expect, it } from "vitest";
import {
  countQuery,
  startConversation,
  TEST_ORIGIN,
  useTempDatabase,
  warmChatbotService,
} from "./helpers";
import { CookieJar, enrollTotp, provisionStaff, signInWithTotp } from "./auth-helpers";

/**
 * Ticket 51: staff can delete one closed conversation from the History tab
 * or clear every closed conversation at once, both behind a real modal
 * dialog. Deletion reuses the retention sweep's transactional purge
 * primitive — no second deletion path — and Clear history is owner-only
 * while single deletes match the other desk actions.
 */

const OWNER_EMAIL = "owner@example.edu";
const OWNER_PASSWORD = "owner-history-lantern-8w";
const STAFF_EMAIL = "helper@example.edu";
const STAFF_PASSWORD = "helper-history-meadow-2v";

let ownerTotp: Awaited<ReturnType<typeof enrollTotp>>;
let staffTotp: Awaited<ReturnType<typeof enrollTotp>>;

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await warmChatbotService();
  await provisionStaff({ email: OWNER_EMAIL, password: OWNER_PASSWORD, name: "Olive", role: "owner" });
  await provisionStaff({ email: STAFF_EMAIL, password: STAFF_PASSWORD, name: "Sam" });
  ownerTotp = await enrollTotp(new CookieJar(), OWNER_EMAIL, OWNER_PASSWORD);
  staffTotp = await enrollTotp(new CookieJar(), STAFF_EMAIL, STAFF_PASSWORD);
});

/** A conversation row in the given state, straight SQL (no lifecycle needed). */
async function seedConversation(state: "closed" | "claimed"): Promise<string> {
  const { getChatbotService } = await import("../src/db/service");
  const { db } = await getChatbotService();
  const id = crypto.randomUUID();
  // Postgres's conversations.last_activity_at is NOT NULL (ticket 68); the
  // stores create conversations with last_activity_at = created_at, so the
  // raw seed mirrors that.
  const createdAt = new Date().toISOString();
  await db.run(
    "INSERT INTO conversations (id, state, created_at, last_activity_at) VALUES (?, ?, ?, ?)",
    id,
    state,
    createdAt,
    createdAt,
  );
  await db.run(
    "INSERT INTO messages (id, conversation_id, role, text, created_at) VALUES (?, ?, 'visitor', 'Please help me', ?)",
    crypto.randomUUID(),
    id,
    new Date().toISOString(),
  );
  await db.run(
    "INSERT INTO visitor_sessions (token_hash, conversation_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    `hash-${id}`,
    id,
    new Date().toISOString(),
    new Date(Date.now() + 3_600_000).toISOString(),
  );
  return id;
}

async function deleteRequest(jar: CookieJar | null, id: string): Promise<Response> {
  const { POST } = await import("../src/app/api/staff/conversations/[id]/delete/route");
  return POST(
    new Request(`${TEST_ORIGIN}/api/staff/conversations/${id}/delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(jar ? { cookie: jar.header() } : {}),
        origin: TEST_ORIGIN,
      },
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function clearRequest(jar: CookieJar | null): Promise<Response> {
  const { POST } = await import("../src/app/api/staff/conversations/clear-history/route");
  return POST(
    new Request(`${TEST_ORIGIN}/api/staff/conversations/clear-history`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(jar ? { cookie: jar.header() } : {}),
        origin: TEST_ORIGIN,
      },
    }),
  );
}

function staffJar(): Promise<CookieJar> {
  return (async () => {
    const jar = new CookieJar();
    await signInWithTotp(jar, STAFF_EMAIL, STAFF_PASSWORD, staffTotp);
    return jar;
  })();
}

function ownerJar(): Promise<CookieJar> {
  return (async () => {
    const jar = new CookieJar();
    await signInWithTotp(jar, OWNER_EMAIL, OWNER_PASSWORD, ownerTotp);
    return jar;
  })();
}

async function conversationExists(id: string): Promise<boolean> {
  const { getChatbotService } = await import("../src/db/service");
  const { db } = await getChatbotService();
  return (
    ((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM conversations WHERE id = ?", id))
      ?.n ?? 0) > 0
  );
}

describe("the purge contract refuses live conversations (ticket 51, widened by 62)", () => {
  it("refuses a live claimed conversation and removes a closed one with its data", async () => {
    const { getChatbotService } = await import("../src/db/service");
    const { historyQuietBefore } = await import("../src/domain/activity");
    const { store } = await getChatbotService();

    // Freshly active: History membership (closed, or quiet past the window)
    // is what makes a conversation deletable — tests/history-eligibility
    // covers the quiet non-closed rows.
    const claimed = await seedConversation("claimed");
    expect(await store.purgeHistoryConversation(claimed, historyQuietBefore())).toBe(false);
    expect(await conversationExists(claimed)).toBe(true);

    const closed = await seedConversation("closed");
    expect(await store.purgeHistoryConversation(closed, historyQuietBefore())).toBe(true);
    expect(await conversationExists(closed)).toBe(false);
    const { db } = await getChatbotService();
    // countQuery casts the PG bigint count to int — Postgres hands COUNT(*)
    // back as a string, which .toBe(0) would reject (ticket 68).
    expect(
      (
        await db.get<{ n: number }>(
          countQuery(
            "SELECT COUNT(*)::int AS n FROM messages WHERE conversation_id = ?",
            "SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?",
          ),
          closed,
        )
      )?.n,
    ).toBe(0);
    expect(
      (
        await db.get<{ n: number }>(
          countQuery(
            "SELECT COUNT(*)::int AS n FROM visitor_sessions WHERE conversation_id = ?",
            "SELECT COUNT(*) AS n FROM visitor_sessions WHERE conversation_id = ?",
          ),
          closed,
        )
      )?.n,
    ).toBe(0);
  });
});

describe("POST /api/staff/conversations/[id]/delete (ticket 51)", () => {
  it("rejects unauthenticated callers", async () => {
    const id = await seedConversation("closed");
    expect((await deleteRequest(null, id)).status).toBe(401);
  });

  it("deletes a closed conversation for a signed-in staff member", async () => {
    const jar = await staffJar();
    const id = await seedConversation("closed");
    const response = await deleteRequest(jar, id);
    expect(response.status).toBe(200);
    expect(await conversationExists(id)).toBe(false);
    // The conversation is gone for good: a second delete finds nothing.
    expect((await deleteRequest(jar, id)).status).toBe(404);
  });

  it("refuses conversations that are still live", async () => {
    const jar = await staffJar();
    const claimed = await seedConversation("claimed");
    const response = await deleteRequest(jar, claimed);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error?: { message?: string } };
    expect(body.error?.message).toMatch(/live/i);
    expect(await conversationExists(claimed)).toBe(true);
  });
});

describe("POST /api/staff/conversations/clear-history (ticket 51)", () => {
  it("is owner-only", async () => {
    expect((await clearRequest(null)).status).toBe(401);
    expect((await clearRequest(await staffJar())).status).toBe(403);
  });

  it("removes every closed conversation and leaves live claimed ones listed", async () => {
    const closedA = await seedConversation("closed");
    const closedB = await seedConversation("closed");
    const claimed = await seedConversation("claimed");

    const response = await clearRequest(await ownerJar());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { removed: number };
    expect(body.removed).toBeGreaterThanOrEqual(2);
    expect(await conversationExists(closedA)).toBe(false);
    expect(await conversationExists(closedB)).toBe(false);
    expect(await conversationExists(claimed)).toBe(true);
  });
});

describe("the confirmation dialog and row structure (ticket 51)", () => {
  it("introduces a real modal, never window.confirm", async () => {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const { repoRoot } = await import("../src/paths");
    const dialog = await readFile(
      path.join(repoRoot(), "src/app/dashboard/confirm-dialog.tsx"),
      "utf8",
    );
    expect(dialog).toContain('role="dialog"');
    expect(dialog).toContain('aria-modal="true"');
    // Escape closes; focus moves into the dialog on open.
    expect(dialog).toContain("Escape");
    expect(dialog).toMatch(/\.focus\(\)/);
    expect(dialog).toContain("onCancel");

    // No dashboard source confirms deletion through the browser.
    const { readdir } = await import("node:fs/promises");
    const dashboardDir = path.join(repoRoot(), "src/app/dashboard");
    const files: string[] = [];
    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.name.endsWith(".tsx")) {
          files.push(full);
        }
      }
    }
    await walk(dashboardDir);
    for (const file of files) {
      expect(await readFile(file, "utf8"), file).not.toContain("window.confirm");
    }
  });

  it("keeps the delete control a sibling of the row link", async () => {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const { repoRoot } = await import("../src/paths");
    const entry = await readFile(path.join(repoRoot(), "src/app/dashboard/inbox/desk-entry.tsx"), "utf8");
    // The Link element closes before the delete control renders: the button
    // must never nest inside the anchor.
    expect(entry.lastIndexOf("</Link>")).toBeLessThan(entry.indexOf("<DeleteConversationButton"));
    // Ticket 42's pending hint still consumes useLinkStatus inside the Link.
    expect(entry).toContain("useLinkStatus");
    // Every History row offers deletion; live rows never do (ticket 62).
    expect(entry).toContain("const deletable = !item.active;");
  });

  it("gates Clear history to owners with the History count", async () => {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const { repoRoot } = await import("../src/paths");
    const desk = await readFile(
      path.join(repoRoot(), "src/app/dashboard/inbox/conversation-desk.tsx"),
      "utf8",
    );
    expect(desk).toContain('guard.staff.role === "owner"');
    expect(desk).toContain("ClearHistoryButton");
    expect(desk).toContain("count={history.length}");
  });

  it("uses the ticket-42 pending verbs for both destructive actions", async () => {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const { repoRoot } = await import("../src/paths");
    const actions = await readFile(
      path.join(repoRoot(), "src/app/dashboard/inbox/history-actions.tsx"),
      "utf8",
    );
    expect(actions).toContain("Deleting…");
    expect(actions).toContain("Clearing…");
    expect(actions).toContain("/api/staff/conversations/clear-history");
    expect(actions).toContain("/delete");
  });
});
