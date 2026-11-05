import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/paths";

/**
 * Ticket 56: the Answers tab matches the approved mockup — a filled primary
 * New Answer button, a search field with icon and a composing status filter
 * over a live count/order line, per-rule icon tiles from a deterministic
 * topic map, check-mark Published pills, iconified meta rows, single-line
 * collapsed previews, and an expanded card whose divider foot carries
 * publisher/reviewed/phrases with a compact Edit. Presentation only: no
 * backend, API, schema, or matching-logic change, and the tabs, forms, and
 * save flows from ticket 55 stay untouched.
 */

const PAGE = "src/app/dashboard/answers/page.tsx";
const WORKSPACE = "src/app/dashboard/answers/answers-workspace.tsx";
const CSS = "src/app/dashboard/dashboard.module.css";

async function read(rel: string): Promise<string> {
  return readFile(path.join(repoRoot(), rel), "utf8");
}

describe("the header action (ticket 56)", () => {
  it("renders New Answer as a filled primary button with a plus icon", async () => {
    const page = await read(PAGE);
    // Filled primary treatment (was the outline secondary button), still in
    // the heading row and pointed at the editor.
    expect(page).toContain("answersHead");
    expect(page).toContain('href="/dashboard/answers/new"');
    expect(page).toContain("primaryButton");
    expect(page).not.toContain("secondaryButton");
    // Title-case label per the mockup, with a decorative plus mark.
    expect(page).toContain("New Answer");
    expect(page).toMatch(/<svg[^>]*aria-hidden="true"[\s\S]{0,300}?New Answer/);
    expect(page).not.toContain("New answer");
  });
});

describe("search, status filter, and the count/order line (ticket 56)", () => {
  it("gives the search its magnifying-glass icon and mockup placeholder", async () => {
    const workspace = await read(WORKSPACE);
    expect(workspace).toContain('placeholder="Search answers…"');
    // The icon wraps the input decoratively; the accessible label survives.
    expect(workspace).toContain("answersSearchWrap");
    expect(workspace).toContain('aria-label="Search answers"');
    expect(workspace).toContain('type="search"');
  });

  it("adds a labelled status filter composing AND with the text search", async () => {
    const workspace = await read(WORKSPACE);
    expect(workspace).toMatch(/<select[^>]*aria-label="Filter by status"/);
    expect(workspace).toContain("All statuses");
    expect(workspace).toContain('value="published"');
    expect(workspace).toContain('value="draft"');
    // One pure entry point filters by both, client-side — still no fetches.
    expect(workspace).toMatch(/filterAnswerRules\(rules, query, status\)/);
    expect(workspace).not.toContain("fetch(");
  });

  it("shows a live result count and an informational sort note", async () => {
    const workspace = await read(WORKSPACE);
    expect(workspace).toMatch(/aria-live="polite"/);
    // The count shares the meta rows' plural() helper.
    expect(workspace).toMatch(/plural\(visible\.length, "answer"\)/);
    expect(workspace).toContain("Sorted by current order");
    // The note is plain text with a glyph — no reordering control.
    expect(workspace).toContain("answersSortNote");
    expect(workspace).not.toMatch(/<button[^>]*answersSortNote|<select[^>]*answersSortNote/);
  });

  it("explains a status-only zero honestly instead of blaming an empty query", async () => {
    const workspace = await read(WORKSPACE);
    // A text query keeps ticket 55's no-match copy; a bare status filter
    // that empties the list names the status instead.
    expect(workspace).toContain("No answers match");
    expect(workspace).toContain("No draft answers yet.");
    expect(workspace).toContain("No published answers yet.");
  });

  it("keeps the filter helpers pure and directly testable", async () => {
    const { filterAnswerRules } = await import("../src/app/dashboard/answers/answers-workspace");
    const baseTime = new Date("2026-11-05T09:00:00Z").toISOString();
    const rule = (id: string, topic: string, status: "published" | "draft") => ({
      id,
      topic,
      response: `${topic} details for visitors.`,
      phrases: ["p"],
      status,
      updatedAt: baseTime,
      publishedBy: null,
      reviewedAt: null,
      publishedByName: null,
    });
    const rules = [
      rule("a", "Scholarships", "published"),
      rule("b", "Fees", "draft"),
      rule("c", "Parking permits", "published"),
    ];

    // Status alone.
    expect(filterAnswerRules(rules, "", "all")).toHaveLength(3);
    expect(filterAnswerRules(rules, "", "published").map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterAnswerRules(rules, "", "draft").map((r) => r.id)).toEqual(["b"]);
    // Text alone (unchanged from ticket 55).
    expect(filterAnswerRules(rules, "scholar", "all").map((r) => r.id)).toEqual(["a"]);
    // Composed: both must match (AND).
    expect(filterAnswerRules(rules, "scholar", "published").map((r) => r.id)).toEqual(["a"]);
    expect(filterAnswerRules(rules, "scholar", "draft")).toEqual([]);
    expect(filterAnswerRules(rules, "parking", "draft")).toEqual([]);
    // An unknown status value filters like "all" (defensive default).
    expect(filterAnswerRules(rules, "", "everything" as "all")).toHaveLength(3);
  });
});

describe("the topic icon map (ticket 56)", () => {
  it("maps topics to icons deterministically with a document fallback", async () => {
    const { iconForTopic } = await import("../src/app/dashboard/answers/answers-workspace");
    expect(iconForTopic("Admissions")).toBe("people");
    expect(iconForTopic("Campus visits")).toBe("people");
    expect(iconForTopic("Fees")).toBe("coins");
    expect(iconForTopic("Tuition and payment plans")).toBe("coins");
    expect(iconForTopic("Scholarships")).toBe("graduation");
    expect(iconForTopic("Financial aid office")).toBe("graduation");
    expect(iconForTopic("Library hours")).toBe("book");
    expect(iconForTopic("Campus parking")).toBe("car");
    // Case never matters; anything else falls back to the document.
    expect(iconForTopic("PARKING")).toBe("car");
    expect(iconForTopic("Registrar forms")).toBe("document");
    expect(iconForTopic("")).toBe("document");
  });

  it("renders every card a decorative icon tile from the map", async () => {
    const workspace = await read(WORKSPACE);
    expect(workspace).toContain("iconForTopic");
    expect(workspace).toContain("answersCardTile");
    // Decorative: the tile hides from assistive tech; the topic text beside
    // it carries the meaning.
    expect(workspace).toMatch(/answersCardTile[^>]*aria-hidden="true"/);
  });
});

describe("badges and iconified meta (ticket 56)", () => {
  it("makes the Published badge a check-marked title-case pill; Draft stays visible text", async () => {
    const workspace = await read(WORKSPACE);
    expect(workspace).toContain("Published");
    expect(workspace).toContain("Draft");
    // The old lowercase badge texts are gone.
    expect(workspace).not.toContain(">published</span>");
    expect(workspace).not.toContain(">draft</span>");
    // A stroke check mark rides inside the published pill — every mark is
    // built on the shared Glyph wrapper, which is always decorative.
    expect(workspace).toMatch(/publishedBadge[\s\S]{0,120}?<CheckIcon \/>/);
    expect(workspace).toMatch(/aria-hidden="true"[\s\S]{0,300}?stroke="currentColor"/);
    expect(workspace).not.toMatch(/react-icons|lucide|heroicons|@iconify/);
    expect(workspace).not.toMatch(/fill="#(?!none)/);
  });

  it("prefixes every meta item with its small stroke icon", async () => {
    const workspace = await read(WORKSPACE);
    // Person (publisher), calendar (reviewed date), speech bubble (phrase
    // count), funnel (keyword conditions), chain link (college page link).
    for (const marker of [
      "answersMetaItem",
      "Reviewed",
      "keyword condition",
      "College page link",
      "Published by",
    ]) {
      expect(workspace, marker).toContain(marker);
    }
    // Meta items are structured spans now, not one interpolated string.
    expect(workspace).not.toContain("` · `");
  });

  it("truncates collapsed previews to a single line", async () => {
    const css = await read(CSS);
    expect(css).toMatch(/\.answersCardPreview \{[^}]*white-space: nowrap/s);
    expect(css).toMatch(/\.answersCardPreview \{[^}]*text-overflow: ellipsis/s);
    expect(css).not.toMatch(/\.answersCardPreview \{[^}]*-webkit-line-clamp/s);
    // An open card shows the full answer instead of the clamped preview and
    // the collapsed meta row stands down with it.
    expect(css).toMatch(/\.answersCard\[data-open\] \.answersCardPreview \{\s*display: none;/s);
    expect(css).toMatch(
      /\.answersCard\[data-open\] \.answersCardToggle \.answersCardMeta \{\s*display: none;/s,
    );
  });
});

describe("the expanded card foot (ticket 56)", () => {
  it("divides the full answer from a meta row carrying a compact Edit", async () => {
    const workspace = await read(WORKSPACE);
    expect(workspace).toContain("answersCardFoot");
    expect(workspace).toMatch(/href=\{`\/dashboard\/answers\/\$\{rule\.id\}`\}/);
    // The compact outline Edit with its pencil mark, right-aligned on the
    // foot row.
    expect(workspace).toContain("answersEdit");
    // The draft trail survives as the foot's fallback content.
    expect(workspace).toContain("Draft · last edited");
    // Collapsed bodies stay out of the tree and tab order.
    expect(workspace).toContain("inert={!open}");
    expect(workspace).toContain("aria-expanded={open}");
  });

  it("styles the foot divider and the blue outline Edit in the tokens", async () => {
    const css = await read(CSS);
    expect(css).toMatch(/\.answersCardFoot \{[^}]*border-top: 1px solid var\(--line\)/s);
    expect(css).toMatch(/\.answersEdit \{[^}]*color: var\(--sfc-blue\)/s);
    expect(css).toMatch(/\.answersEdit \{[^}]*min-height: 36px/s);
  });
});

describe("toolbar and tile styling (ticket 56)", () => {
  it("styles the search/filter row, count line, and icon tiles in tokens", async () => {
    const css = await read(CSS);
    for (const className of [
      ".answersToolbar",
      ".answersSearchWrap",
      ".answersStatusFilter",
      ".answersCountRow",
      ".answersCount",
      ".answersSortNote",
      ".answersCardTile",
    ]) {
      expect(css, className).toContain(className);
    }
    // The tile is the soft blue rounded square from the mockup.
    expect(css).toMatch(/\.answersCardTile \{[^}]*background: var\(--sfc-blue-soft\)/s);
    expect(css).toMatch(/\.answersCardTile \{[^}]*color: var\(--sfc-blue\)/s);
    // Touch floors hold on the new controls.
    expect(css).toMatch(/\.answersStatusFilter \{[^}]*min-height: 44px/s);
    expect(css).toMatch(/\.answersSearch \{[^}]*min-height: 44px/s);
    // The pill badges become inline-flex so the check mark aligns.
    expect(css).toMatch(/\.publishedBadge \{[^}]*display: inline-flex/s);
  });

  it("drops the filter below the search on narrow screens", async () => {
    const css = await read(CSS);
    expect(css).toMatch(/\(max-width: 720px\)[\s\S]*?\.answersToolbar/s);
    expect(css).toMatch(/\(max-width: 720px\)[\s\S]*?\.answersSearchWrap \{[^}]*flex-basis: 100%/s);
  });
});

describe("ticket 55 behavior is preserved (ticket 56)", () => {
  it("keeps the tabs, both configuration forms, and their save flows", async () => {
    const workspace = await read(WORKSPACE);
    expect(workspace).toContain('role="tablist"');
    expect(workspace).toContain('useState<AnswersTab>("rules")');
    expect(workspace).toContain("<EscalationPhrasesForm");
    expect(workspace).toContain("<WelcomeForm");
    expect(workspace).toContain("No answer rules yet. Create the first one.");
    expect(workspace).toContain("No answers match");
    expect(workspace).toContain("aria-controls={panelId}");

    for (const form of [
      "src/app/dashboard/answers/escalation-phrases-form.tsx",
      "src/app/dashboard/answers/welcome-form.tsx",
    ]) {
      const source = await read(form);
      expect(source, form).toContain('method: "PUT"');
    }
  });
});
