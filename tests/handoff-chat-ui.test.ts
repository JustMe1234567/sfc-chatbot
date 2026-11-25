import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/paths";

/**
 * Ticket 103 — the visitor-side handoff chat UI. Source pins for the
 * contract the API suites (awaiting-lock, escalation-flow, handoff-options,
 * waiting-notice) exercise live: the vertically stacked click-to-handoff
 * options, the in-transcript notices, the hidden topic chips during a
 * handoff, the "Staff"/"Admissions Chatbot" sender labels, and the
 * waiting-notice setting wired the welcome-message way (ticket 41).
 */
describe("the handoff chat UI (ticket 103, source contract)", () => {
  const WIDGET = "src/app/widget/frame/page.tsx";
  const CSS = "src/app/widget/frame/frame.module.css";
  const CONTENT = "src/app/widget/frame/hooks/usePublishedContent.ts";

  async function read(rel: string): Promise<string> {
    return readFile(path.join(repoRoot(), rel), "utf8");
  }

  it("stacks the click-to-handoff options vertically in both render sites", async () => {
    const widget = await read(WIDGET);
    // Both placements — the fresh stack and the ongoing one after bot
    // answers — use the stacked suggestion composition, whose chips wrap
    // their full text (no 240px cap, no two-line clamp). The prompt
    // choices inside bubbles and the suggested-questions rail keep their
    // own layouts.
    for (const start of [
      widget.indexOf('aria-label="Options to reach our staff"'),
      widget.lastIndexOf('aria-label="Options to reach our staff"'),
    ]) {
      if (start < 0) throw new Error("an options group is missing from the widget");
      const slice = widget.slice(start, widget.indexOf("</div>", start));
      expect(slice).toContain("styles.freshSuggest");
      expect(slice).not.toContain("topicLabel");
      expect(slice).not.toContain("styles.topicButton");
    }
    const css = await read(CSS);
    // The stacked chips' full-text layout: the cap and clamp stay only on
    // the suggested-questions rail's own chips.
    expect(css).toMatch(/\.freshSuggest \{[^}]*max-width: 85%/s);
  });

  it("hides the topic chips, the fresh stack, and the intro line once handoff begins", async () => {
    const widget = await read(WIDGET);
    // One episode flag: the handoff runs from escalation through the claim
    // until release or closure.
    expect(widget).toContain("const handoffActive = handoff || claimed;");
    // The topicless intro line stays hidden during the handoff states —
    // the in-transcript notice and the open composer are the guidance.
    const introStart = widget.indexOf("{visibleTopics.length === 0");
    expect(introStart).toBeGreaterThan(-1);
    expect(widget.slice(introStart, introStart + 160)).toContain("!handoffActive");
    // The fresh suggestion stack and the ongoing rail hide too.
    const freshStart = widget.indexOf("{!contactRequired && visibleTopics.length > 0");
    expect(freshStart).toBeGreaterThan(-1);
    expect(widget.slice(freshStart, freshStart + 160)).toContain("!handoffActive");
    const railStart = widget.indexOf("{!freshStart && !contactRequired && visibleTopics.length > 0");
    expect(railStart).toBeGreaterThan(-1);
    expect(widget.slice(railStart, railStart + 160)).toContain("!handoffActive");
  });

  it("labels advisor messages Staff and bot messages Admissions Chatbot in the visitor transcript", async () => {
    const widget = await read(WIDGET);
    // The owner's vocabulary (ticket 103 decisions 3–4): visitor-facing
    // human references say "Staff"; the chatbot's own branding is
    // "Admissions Chatbot". Visitors carry no label; the dashboard's
    // transcript labels are ticket 102's sweep, untouched here.
    expect(widget).toContain('bot: "Admissions Chatbot"');
    expect(widget).toContain('staff: "Staff"');
    expect(widget).toContain("senderLabel");
    const css = await read(CSS);
    expect(css).toContain(".senderLabel");
  });

  it("renders the notices as small centered transcript lines", async () => {
    const widget = await read(WIDGET);
    const css = await read(CSS);
    expect(widget).toContain("styles.notice");
    // Small, centered, inside the log — not a banner above it.
    expect(css).toMatch(/\.notice \{[^}]*align-self: center/s);
    expect(css).toMatch(/\.notice \{[^}]*text-align: center/s);
    // The banner block and the old waiting line are gone.
    expect(css).not.toContain(".handoff");
    expect(css).not.toContain(".waiting");
  });

  it("feeds the waiting notice from the published setting with the default fallback", async () => {
    const content = await read(CONTENT);
    expect(content).toContain('fetch("/api/v1/waiting-notice")');
    expect(content).toContain("DEFAULT_WAITING_NOTICE");
    expect(content).toContain("waitingNotice");
  });

  it("wires the waiting notice as a seeded setting with an Answers-area form", async () => {
    const service = await read("src/db/service.ts");
    // Seeded insert-if-absent in both database builders.
    expect(service.match(/await seedWaitingNotice\(appDb\);/g)).toHaveLength(2);

    const settings = await read("src/settings.ts");
    expect(settings).toContain("WAITING_NOTICE_KEY");
    expect(settings).toContain("DEFAULT_WAITING_NOTICE");

    const staffRoute = await read("src/app/api/staff/settings/waiting-notice/route.ts");
    // Gated to the roles that edit the welcome message (ticket 102: Admin
    // and Admissions Advisor).
    expect(staffRoute).toContain("ANSWER_RULE_ROLES");
    expect(staffRoute).toContain("invalid_waiting_notice");

    const workspace = await read("src/app/dashboard/answers/answers-workspace.tsx");
    expect(workspace).toContain('"waiting"');
    expect(workspace).toContain("WaitingNoticeForm");
    const form = await read("src/app/dashboard/answers/waiting-notice-form.tsx");
    expect(form).toContain('"/api/staff/settings/waiting-notice"');
    expect(form).toMatch(/method: "PUT"/);
    const page = await read("src/app/dashboard/answers/page.tsx");
    expect(page).toContain("getWaitingNotice");
  });
});
