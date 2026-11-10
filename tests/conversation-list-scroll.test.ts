import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/paths";

beforeEach(() => {
  vi.resetModules();
});

describe("conversation-list scroll memory (ticket 65)", () => {
  it("remembers Conversations and History independently for the session", async () => {
    const scroll = await import("../src/app/dashboard/inbox/conversation-list-scroll");

    scroll.rememberConversationListScroll("active", 420);
    scroll.rememberConversationListScroll("history", 860);

    expect(scroll.conversationListScroll("active", 1200, 500)).toBe(420);
    expect(scroll.conversationListScroll("history", 1400, 500)).toBe(860);
  });

  it("clamps a remembered offset when the list becomes shorter", async () => {
    const scroll = await import("../src/app/dashboard/inbox/conversation-list-scroll");

    scroll.rememberConversationListScroll("history", 900);

    expect(scroll.conversationListScroll("history", 620, 500)).toBe(120);
    expect(scroll.conversationListScroll("history", 300, 500)).toBe(0);
  });

  it("restores before paint and keeps route navigation from forcing a scroll reset", async () => {
    const wrapper = await readFile(
      path.join(repoRoot(), "src/app/dashboard/inbox/conversation-list.tsx"),
      "utf8",
    );
    const desk = await readFile(
      path.join(repoRoot(), "src/app/dashboard/inbox/conversation-desk.tsx"),
      "utf8",
    );
    const entry = await readFile(
      path.join(repoRoot(), "src/app/dashboard/inbox/desk-entry.tsx"),
      "utf8",
    );
    const styles = await readFile(
      path.join(repoRoot(), "src/app/dashboard/dashboard.module.css"),
      "utf8",
    );

    expect(wrapper).toContain("useLayoutEffect");
    expect(wrapper).toContain("rememberConversationListScroll(view, list.scrollTop)");
    expect(desk).toContain("<ConversationList view={view}>");
    expect(desk).toMatch(/<Link[^>]*scroll=\{false\}[^>]*href="\/dashboard\/inbox"/s);
    expect(entry).toContain("scroll={false}");
    expect(styles).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.deskList \{[\s\S]*?max-height: calc\(100dvh - 8rem\)/,
    );
  });
});
