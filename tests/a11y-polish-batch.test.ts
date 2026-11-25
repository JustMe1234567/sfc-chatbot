import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/paths";

/**
 * Ticket 29: the widget and dashboard accessibility polish batch. Source
 * pins for the surviving boxes; the audit's email-autocomplete and
 * Escape-confirm boxes were already satisfied by tickets 66 and 39, and
 * the pins below keep those regressions visible too. Live behavior is
 * certified by scripts/cert29-a11y-polish.mjs.
 */
describe("a11y polish batch (ticket 29)", () => {
  it("warns visually hidden about the new tab on every external answer link", async () => {
    const frame = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/page.tsx"),
      "utf8",
    );
    const ruleForm = await readFile(
      path.join(repoRoot(), "src/app/dashboard/answers/rule-form.tsx"),
      "utf8",
    );
    for (const [name, source] of [
      ["widget", frame],
      ["rule form", ruleForm],
    ] as const) {
      const start = source.indexOf('target="_blank"');
      const slice = source.slice(start, source.indexOf("</a>", start));
      expect(slice, name).toContain("(opens in a new tab)");
      expect(slice, name).toContain("srOnly");
    }
  });

  it("keeps the contact gate's email autocomplete the audit asked for (via ticket 66)", async () => {
    const frame = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/page.tsx"),
      "utf8",
    );
    const start = frame.indexOf('id="sfcw-email"');
    const slice = frame.slice(start, start + 220);
    expect(slice).toContain('autoComplete="email"');
  });

  it("cancels the clear confirm on Escape before closing the widget (via ticket 39)", async () => {
    // Ticket 33 moved the Escape cascade into the frame's clear-flow hook;
    // the pin follows the code.
    const clearFlow = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/hooks/useClearFlow.ts"),
      "utf8",
    );
    const start = clearFlow.indexOf('function onKeyDown');
    const slice = clearFlow.slice(start, clearFlow.indexOf("requestClose();", start));
    // The confirm branch stands between the menu branch and the close, so
    // Escape always cancels the dialog first.
    const menuAt = slice.indexOf('menuOpen');
    const confirmAt = slice.indexOf('clearState === "confirm"');
    expect(menuAt).toBeGreaterThan(-1);
    expect(confirmAt).toBeGreaterThan(menuAt);
  });

  it("renders the dashboard skip link as the first focusable element", async () => {
    const header = await readFile(
      path.join(repoRoot(), "src/app/dashboard/header.tsx"),
      "utf8",
    );
    const returnStart = header.indexOf("return (");
    const fragment = header.slice(returnStart, header.indexOf("</aside>", returnStart));
    expect(fragment).toContain('href="#sfc-content"');
    expect(fragment).toContain("Skip to content");
    expect(fragment.indexOf("skipLink")).toBeLessThan(fragment.indexOf("<aside"));
  });

  it("targets the skip link from every dashboard page that renders the header", async () => {
    const targets = [
      "src/app/dashboard/analytics/page.tsx",
      "src/app/dashboard/answers/[id]/page.tsx",
      "src/app/dashboard/answers/new/page.tsx",
      "src/app/dashboard/answers/page.tsx",
      "src/app/dashboard/contacts/page.tsx",
      "src/app/dashboard/settings/page.tsx",
      "src/app/dashboard/staff/page.tsx",
      // The inbox desk serves /dashboard/inbox, /inbox/history, and
      // /inbox/[id] — the main dashboard surface.
      "src/app/dashboard/inbox/conversation-desk.tsx",
    ];
    for (const target of targets) {
      const source = await readFile(path.join(repoRoot(), target), "utf8");
      expect(source, target).toContain('id="sfc-content"');
      expect(source, target).toContain("tabIndex={-1}");
    }
  });

  it("titles every dashboard route through the template", async () => {
    const layout = await readFile(
      path.join(repoRoot(), "src/app/dashboard/layout.tsx"),
      "utf8",
    );
    expect(layout).toContain('template: "%s · Springfield College chat"');
    expect(layout).toContain('default: "Springfield College chat"');

    const titles: [string, string][] = [
      ["src/app/dashboard/inbox/page.tsx", 'title: "Inbox"'],
      ["src/app/dashboard/inbox/history/page.tsx", 'title: "History"'],
      ["src/app/dashboard/inbox/[id]/page.tsx", 'title: "Conversation"'],
      ["src/app/dashboard/analytics/page.tsx", 'title: "Analytics"'],
      ["src/app/dashboard/answers/page.tsx", 'title: "Answers"'],
      ["src/app/dashboard/answers/new/page.tsx", 'title: "New rule"'],
      ["src/app/dashboard/answers/[id]/page.tsx", 'title: "Edit rule"'],
      ["src/app/dashboard/contacts/page.tsx", 'title: "Visitor contacts"'],
      ["src/app/dashboard/settings/page.tsx", 'title: "Settings"'],
      ["src/app/dashboard/staff/page.tsx", 'title: "Staff accounts"'],
    ];
    for (const [target, pin] of titles) {
      const source = await readFile(path.join(repoRoot(), target), "utf8");
      expect(source, target).toContain(pin);
    }

    // The client pages carry their titles through segment layouts.
    const login = await readFile(
      path.join(repoRoot(), "src/app/dashboard/login/layout.tsx"),
      "utf8",
    );
    expect(login).toContain('title: "Sign in"');
  });
});
