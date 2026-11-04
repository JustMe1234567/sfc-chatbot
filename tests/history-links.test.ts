import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/paths";

/**
 * Ticket 48: the desk's History tab and the transcript's back link must
 * target the archive route that exists (`/dashboard/inbox/history`). The
 * inbox page ignores a `?view=history` query entirely, so staff clicking
 * History were returned to the live desk.
 */
describe("history navigation targets the archive route (ticket 48)", () => {
  it("links the History tab and the back link to /dashboard/inbox/history", async () => {
    const source = await readFile(
      path.join(repoRoot(), "src/app/dashboard/inbox/conversation-desk.tsx"),
      "utf8",
    );
    expect(source).toContain('href="/dashboard/inbox/history"');
    expect(source).not.toContain("?view=history");
  });
});
