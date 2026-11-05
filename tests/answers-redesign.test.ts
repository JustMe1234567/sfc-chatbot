import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/paths";

/**
 * Ticket 55: the Answers tab redesign — the page shell with the New answer
 * action top-right, three in-place tabs (Answer Rules default, Handoff
 * Phrases, Welcome Message), client-side search over the loaded rules, and
 * compact expandable answer cards. Everything behavioral is preserved: the
 * two configuration forms keep their save flows, the rule editor page is
 * untouched, and no API or matching logic changes.
 */

const PAGE = "src/app/dashboard/answers/page.tsx";
const WORKSPACE = "src/app/dashboard/answers/answers-workspace.tsx";
const CSS = "src/app/dashboard/dashboard.module.css";

describe("the answers page shell (ticket 55)", () => {
  it("keeps the editor guard and loads everything once for the workspace", async () => {
    const source = await readFile(path.join(repoRoot(), PAGE), "utf8");

    // Role rules unchanged: the Answers tab stays owner+editor.
    expect(source).toContain("requireStaff");
    expect(source).toContain("ANSWER_RULE_ROLES");

    // One data load, handed to the client workspace as props.
    expect(source).toContain("rulesWithPublisherNames");
    expect(source).toContain("getEscalationPhrases");
    expect(source).toContain("getWelcomeMessage");
    expect(source).toContain("AnswersWorkspace");

    // The heading row: description plus the New answer action, top-right.
    expect(source).toContain("answersHead");
    expect(source).toContain('href="/dashboard/answers/new"');
    expect(source).toContain("New answer");
    expect(source).toContain("answersIntro");
  });

  it("no longer renders the old stacked layout", async () => {
    const source = await readFile(path.join(repoRoot(), PAGE), "utf8");

    // The old page rendered cards and both forms itself; the workspace owns
    // them now. The whole-card navigation link is gone from the server page.
    expect(source).not.toContain("conversationCard");
    expect(source).not.toContain("href={`/dashboard/answers/${rule.id}`}");
    expect(source).not.toContain("EscalationPhrasesForm");
    expect(source).not.toContain("WelcomeForm");
  });
});

describe("the answers workspace (ticket 55)", () => {
  it("organizes the content into three tabs with Answer Rules default", async () => {
    const source = await readFile(path.join(repoRoot(), WORKSPACE), "utf8");

    // Tablist/tab semantics, not links: switching is in-place state.
    expect(source).toContain('role="tablist"');
    expect(source).toContain('role="tab"');
    expect(source).toContain("aria-selected");
    expect(source).toContain("Answer Rules");
    expect(source).toContain("Handoff Phrases");
    expect(source).toContain("Welcome Message");
    // Answer Rules is the initial state.
    expect(source).toContain('useState<AnswersTab>("rules")');
    // Panels are labelled, controlled, and swap without navigation.
    expect(source).toContain('role="tabpanel"');
    expect(source).toContain("aria-labelledby");
    expect(source).toContain("hidden={tab !==");
    // The two configuration forms are preserved verbatim as tab content.
    expect(source).toContain("<EscalationPhrasesForm");
    expect(source).toContain("<WelcomeForm");
  });

  it("filters answers client-side, case-insensitively", async () => {
    const source = await readFile(path.join(repoRoot(), WORKSPACE), "utf8");

    // The filter reads the already-loaded array — no fetches anywhere in
    // the workspace file.
    expect(source).toContain("toLowerCase().includes(");
    expect(source).not.toContain("fetch(");
    // The search input is a labelled search box driven by state.
    expect(source).toContain('type="search"');
    expect(source).toContain('aria-label="Search answers"');
    expect(source).toContain("filterAnswerRules(rules, query)");
    // A no-match state explains itself.
    expect(source).toContain("No answers match");
    // The library-empty state survives from the old page.
    expect(source).toContain("No answer rules yet. Create the first one.");
  });

  it("renders compact expandable cards with keyboard accessibility", async () => {
    const source = await readFile(path.join(repoRoot(), WORKSPACE), "utf8");

    // The toggle is a real button announcing its state and its panel.
    expect(source).toContain('type="button"');
    expect(source).toContain("aria-expanded={open}");
    expect(source).toContain("aria-controls={panelId}");
    // Collapsed content shows status, clamped preview, and the counts.
    expect(source).toContain("publishedBadge");
    expect(source).toContain("draftBadge");
    expect(source).toContain("answersCardPreview");
    expect(source).toContain("college page link");
    expect(source).toContain("keyword condition");
    // The expanded body carries the review trail and the Edit action that
    // replaces the old whole-card navigation.
    expect(source).toContain("Published by");
    expect(source).toContain("Draft · last edited");
    expect(source).toContain('href={`/dashboard/answers/${rule.id}`}');
    expect(source).toContain("Edit answer");
    // The collapsed body leaves the accessibility tree and tab order.
    expect(source).toContain("inert={!open}");
  });

  it("exposes the pure filter for direct testing", async () => {
    const { filterAnswerRules } = await import("../src/app/dashboard/answers/answers-workspace");
    const baseTime = new Date("2026-11-05T09:00:00Z").toISOString();
    const rule = (id: string, topic: string, response: string) => ({
      id,
      topic,
      response,
      phrases: ["p"],
      status: "published" as const,
      updatedAt: baseTime,
      publishedBy: null,
      reviewedAt: null,
      publishedByName: null,
    });
    const rules = [
      rule("a", "Scholarships", "Financial aid for new students."),
      rule("b", "Fees", "Tuition and billing information."),
    ];

    // Blank queries match everything; case never matters.
    expect(filterAnswerRules(rules, "")).toHaveLength(2);
    expect(filterAnswerRules(rules, "   ")).toHaveLength(2);
    expect(filterAnswerRules(rules, "SCHOLAR")).toEqual([rules[0]]);
    // Content matches too, not just titles.
    expect(filterAnswerRules(rules, "tuition")).toEqual([rules[1]]);
    expect(filterAnswerRules(rules, "zzz")).toEqual([]);
  });
});

describe("the answers redesign styles (ticket 55)", () => {
  it("styles tabs, search, cards, and the animated reveal", async () => {
    const css = await readFile(path.join(repoRoot(), CSS), "utf8");

    for (const className of [
      ".answersHead",
      ".answersIntro",
      ".answersTabs",
      ".answersPanel",
      ".answersSearch",
      ".answersList",
      ".answersCard",
      ".answersCardToggle",
      ".answersCardPreview",
      ".answersCardReveal",
      ".answersCardBody",
    ]) {
      expect(css, className).toContain(className);
    }

    // The selected tab uses the college blue; controls keep the 44px touch
    // floor; the preview clamps to two lines like the desk's rows.
    expect(css).toMatch(/\.answersTabs button\[aria-selected="true"\]/);
    expect(css).toMatch(/\.answersTabs button \{[^}]*min-height: 44px/s);
    expect(css).toMatch(/\.answersSearch \{[^}]*min-height: 44px/s);
    expect(css).toMatch(/\.answersCardToggle \{[^}]*min-height: 44px/s);
    expect(css).toMatch(/\.answersCardPreview \{[^}]*-webkit-line-clamp: 2/s);
    // The reveal animates through the shared motion tokens, which reduce to
    // instant under prefers-reduced-motion (the tokens go 0ms there).
    expect(css).toMatch(/\.answersCardReveal \{[^}]*transition: grid-template-rows var\(--motion-base\)/s);
    // The scoped Save-button alignment leaves the rule editor page alone.
    expect(css).toContain(".answersPanel .ruleCard button");
    expect(css).toMatch(/\.answersPanel \.ruleCard button \{[^}]*align-self: flex-start/s);
  });
});

describe("existing behavior is untouched (ticket 55)", () => {
  it("keeps the rule editor page and its forms as they are", async () => {
    const editor = await readFile(
      path.join(repoRoot(), "src/app/dashboard/answers/[id]/page.tsx"),
      "utf8",
    );
    expect(editor).toContain("RuleForm");
    expect(editor).toContain("PublishControls");

    for (const form of [
      "src/app/dashboard/answers/escalation-phrases-form.tsx",
      "src/app/dashboard/answers/welcome-form.tsx",
    ]) {
      const source = await readFile(path.join(repoRoot(), form), "utf8");
      // Same endpoints, same payloads — the save flows are preserved.
      expect(source, form).toContain("method: \"PUT\"");
      expect(source, form).toMatch(/\/api\/staff\/settings\//);
    }
  });
});
