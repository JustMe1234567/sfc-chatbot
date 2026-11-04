import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/paths";

/**
 * Ticket 45: staff-facing conversation wording says "Take over", while the
 * internal domain keeps claim/claimed unchanged (state values, API paths,
 * audit action ids). These pins hold the split: product copy reads as
 * takeover, the domain vocabulary does not.
 */
describe("staff-facing takeover copy (ticket 45)", () => {
  it("labels the primary action Take over with a Taking over… pending verb", async () => {
    const source = await readFile(
      path.join(repoRoot(), "src/app/dashboard/conversations/[id]/conversation-actions.tsx"),
      "utf8",
    );
    expect(source).toContain("Take over");
    expect(source).toContain("Taking over…");
    expect(source).not.toContain("Claim conversation");
    expect(source).not.toContain("Claiming…");
    expect(source).not.toContain("Claim failed.");
  });

  it("writes the desk's helper, empty-state, and audit copy as takeover", async () => {
    const source = await readFile(
      path.join(repoRoot(), "src/app/dashboard/inbox/conversation-desk.tsx"),
      "utf8",
    );
    expect(source).toContain("Waiting for a staff member to take over this conversation.");
    expect(source).toContain("took over this conversation");
    // The empty-state paragraph line-breaks in the JSX; pin within one line.
    expect(source).toContain("for a staff member to take over; Active chats are already being");
    expect(source).not.toContain("claim this conversation");
    expect(source).not.toContain("for a claim;");
    // The audit display label changes, the stored action id does not.
    expect(source).toContain("conversation_claimed:");
  });

  it("states takeover in the conflict and validation copy staff can hit", async () => {
    const conflict = await readFile(path.join(repoRoot(), "src/api/staffConversations.ts"), "utf8");
    expect(conflict).toContain("Another staff member took over this chat.");
    expect(conflict).toContain("is already helping in this conversation.");
    expect(conflict).toContain('code: "already_claimed"');
    const reply = await readFile(
      path.join(repoRoot(), "src/app/api/staff/conversations/[id]/reply/route.ts"),
      "utf8",
    );
    expect(reply).toContain("Take over the conversation before replying.");
    const close = await readFile(
      path.join(repoRoot(), "src/app/api/staff/conversations/[id]/close/route.ts"),
      "utf8",
    );
    expect(close).toContain("Take over the conversation before closing it.");
  });

  it("keeps the internal domain vocabulary unchanged", async () => {
    const actions = await readFile(
      path.join(repoRoot(), "src/app/dashboard/conversations/[id]/conversation-actions.tsx"),
      "utf8",
    );
    // The API action path stays claim (inside the fetch template literal).
    expect(actions).toContain("conversations/${conversationId}/${action}");
    const claimRoute = await readFile(
      path.join(repoRoot(), "src/app/api/staff/conversations/[id]/claim/route.ts"),
      "utf8",
    );
    expect(claimRoute).toContain("claimConflictResponse");
    const inbox = await readFile(path.join(repoRoot(), "src/domain/inbox.ts"), "utf8");
    expect(inbox).toContain('awaiting_staff: "waiting"');
    expect(inbox).toContain("claimed");
  });
});
