import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/paths";
import type { RuleView } from "../src/api/staffAnswerRules";

/**
 * Ticket 58: the dashboard matches the supplied reference — a full-height
 * navy rail with the content column as the only scrolling area, and an
 * Answers page whose cards carry the three-dot lifecycle menu (Duplicate,
 * Publish/Unpublish, Archive, Delete) with a real Archived view and a Trash
 * view whose permanent deletion confirms through the shared dialog. The
 * sidebar keeps ticket 57's one-callout compact behavior throughout.
 */

const HEADER = "src/app/dashboard/header.tsx";
const SIDEBAR_PREFERENCE = "src/app/dashboard/sidebar-preference.ts";
const CSS = "src/app/dashboard/dashboard.module.css";
const WORKSPACE = "src/app/dashboard/answers/answers-workspace.tsx";
const ACTIONS = "src/app/dashboard/answers/answer-actions.tsx";
const PAGE = "src/app/dashboard/answers/page.tsx";

async function read(rel: string): Promise<string> {
  return readFile(path.join(repoRoot(), rel), "utf8");
}

const baseTime = new Date("2026-11-06T09:00:00Z").toISOString();

function rule(id: string, status: RuleView["status"]): RuleView {
  return {
    id,
    topic: `Topic ${id}`,
    response: `${id} answer for visitors.`,
    phrases: ["p"],
    status,
    updatedAt: baseTime,
    publishedBy: null,
    reviewedAt: null,
    trashedAt: null,
    publishedByName: null,
  };
}

describe("the full-height shell (ticket 58)", () => {
  it("makes the content column the only scroll area", async () => {
    const css = await read(CSS);

    // The shell is exactly one viewport tall and nothing scrolls at page
    // level; the dynamic-unit override serves mobile browser chrome.
    expect(css).toMatch(/\.shell \{[^}]*height: 100vh/s);
    expect(css).toMatch(/\.shell \{[^}]*height: 100dvh/s);
    expect(css).toMatch(/\.shell \{[^}]*overflow: hidden/s);
    expect(css).not.toMatch(/\.shell \{[^}]*min-height/s);
    // The content column scrolls; the rail spans both grid rows at full
    // height, so scrolling never moves the crest, nav, or Sign out.
    expect(css).toMatch(/\.contentArea \{[^}]*overflow-y: auto/s);
    expect(css).toMatch(/\.contentArea \{[^}]*grid-column: 2/s);
    expect(css).toMatch(/\.sidebar \{[^}]*grid-row: 1 \/ -1/s);
    expect(css).toMatch(/\.sidebar \{[^}]*height: 100%/s);
  });

  it("restores one-document scrolling on narrow screens", async () => {
    const css = await read(CSS);
    const narrow = css.slice(css.lastIndexOf("@media (max-width: 720px)"));
    expect(narrow).toMatch(/\.shell \{[^}]*height: auto/s);
    expect(narrow).toMatch(/\.shell \{[^}]*overflow: visible/s);
    expect(narrow).toMatch(/\.contentArea \{[^}]*overflow: visible/s);
  });

  it("wraps every dashboard page's content in the scroll area", async () => {
    const dashboardDir = path.join(repoRoot(), "src/app/dashboard");
    const files: string[] = [];
    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "conversations") {
            continue; // The legacy per-conversation desk route is unused.
          }
          await walk(full);
        } else if (entry.name.endsWith(".tsx") && !entry.name.endsWith("-form.tsx")) {
          files.push(full);
        }
      }
    }
    await walk(dashboardDir);

    // Every page that renders the shell with its header wraps its content
    // in .contentArea — guard-only fallbacks and delegating pages aside.
    const pages = files.filter((file) => /page\.tsx$|desk\.tsx$|view\.tsx$/.test(file));
    expect(pages.length).toBeGreaterThanOrEqual(8);
    for (const file of pages) {
      const source = await readFile(file, "utf8");
      if (source.includes("<DashboardHeader")) {
        expect(source, file).toContain("styles.contentArea");
      }
    }
  });
});

describe("the reference rail (ticket 58)", () => {
  it("wears its own deep navy without touching the desk's surfaces", async () => {
    const css = await read(CSS);

    // The rail re-declares the shared dark tokens locally: the conversation
    // desk keeps its slate palette.
    expect(css).toMatch(/\.sidebar \{[^}]*--rail-bg: #\w+/s);
    const sidebarBlock = css.slice(css.indexOf(".sidebar {"), css.indexOf(".sidebar[data-collapsed]"));
    expect(sidebarBlock).toMatch(/--rail-bg:\s*#10\w\w\w\w/);
    // Desk list still resolves the original token from :root.
    expect(css).toMatch(/:root \{[^}]*--rail-bg: #1b2330/s);
  });

  it("centers the crest over a divider, with no wordmark", async () => {
    const header = await read(HEADER);
    const css = await read(CSS);

    expect(header).toContain('alt=""');
    expect(header).toMatch(/width=\{44\}/);
    expect(header).not.toContain("sideCollege");
    expect(css).toMatch(/\.sideBrand \{[^}]*justify-content: center/s);
    expect(css).toMatch(/\.sideBrand \{[^}]*border-bottom: 1px solid var\(--rail-line\)/s);
    expect(css).toMatch(/\.brandMark \{[^}]*width: 44px/s);
  });

  it("anchors Sign out at the bottom with the red accent", async () => {
    const css = await read(CSS);

    // The identity divider, then the dark tile with the red mark.
    expect(css).toMatch(/\.sideIdentity \{[^}]*border-top: 1px solid var\(--rail-line\)/s);
    expect(css).toMatch(/\.sideIdentity \.secondaryButton \{[^}]*background: var\(--rail-raised\)/s);
    expect(css).toMatch(/\.sideIdentity \.secondaryButton svg \{[^}]*color: var\(--danger-bright\)/s);
    // Touch floor and full-width row.
    expect(css).toMatch(/\.sideIdentity \.secondaryButton \{[^}]*min-height: 44px/s);
  });

  it("keeps the toggle control leading the rail without breaking ticket 57", async () => {
    const header = await read(HEADER);
    const preference = await read(SIDEBAR_PREFERENCE);

    // Ticket 60 supersedes ticket 58's bottom slot: the control renders
    // first — under the crest, before the nav — and the identity stays last.
    expect(header.indexOf("styles.sideToggle")).toBeLessThan(header.indexOf("styles.sideNav"));
    expect(header.indexOf("styles.sideNav")).toBeLessThan(header.indexOf("styles.sideIdentity"));
    // The aria contract and persistence survive from tickets 52/57. (Ticket
    // 60 hoisted the swapped name into toggleLabel, shared with the rail's
    // callout so the two can never drift.)
    expect(header).toMatch(/const toggleLabel = collapsed \? "Expand navigation" : "Collapse navigation";/);
    expect(header).toContain("aria-label={toggleLabel}");
    expect(preference).toContain("dashboard.sidebar.collapsed");
    // Compact-by-default with one-at-a-time callouts is untouched.
    expect(header).toContain("useState(initialSidebarCollapsed)");
    expect(preference).toContain("return sessionCollapsed ?? true");
    expect(header).toContain('calloutProps("Sign out")');
  });

  it("keeps visitor contacts and no Home entry", async () => {
    const header = await read(HEADER);

    expect(header).toContain('href: "/dashboard/contacts", label: "Visitor contacts"');
    expect(header).not.toContain('/dashboard/notifications');
    expect(header).not.toMatch(/label: "Home"/);
    expect(header).not.toContain('href: "/dashboard"');
  });
});

describe("the three-dot menu (ticket 58)", () => {
  it("shows the reference's items in order, with the divider before red Delete", async () => {
    const { menuItemsFor } = await import("../src/app/dashboard/answers/answer-actions");

    const published = menuItemsFor(rule("p", "published"));
    expect(published.map((item) => item.label)).toEqual([
      "Duplicate",
      "Unpublish",
      "Archive",
      "Delete",
    ]);
    // Delete is the danger row, behind the divider.
    expect(published.find((item) => item.label === "Delete")?.danger).toBe(true);
    expect(published.find((item) => item.label === "Delete")?.dividerBefore).toBe(true);
    // A draft card shows Publish in place of Unpublish.
    const draft = menuItemsFor(rule("d", "draft"));
    expect(draft.map((item) => item.label)).toEqual(["Duplicate", "Publish", "Archive", "Delete"]);

    // The lifecycle views offer their own actions.
    expect(menuItemsFor(rule("a", "archived")).map((item) => item.label)).toEqual(["Restore"]);
    const trashed = menuItemsFor(rule("t", "trashed"));
    expect(trashed.map((item) => item.label)).toEqual(["Restore", "Permanently delete"]);
    expect(trashed.find((item) => item.label === "Permanently delete")?.danger).toBe(true);
  });

  it("renders an accessible menu that never acts on open", async () => {
    const actions = await read(ACTIONS);

    // Menu semantics and the keyboard contract: Escape closes and refocuses,
    // arrows move, Tab dismisses, outside pointer closes.
    expect(actions).toContain('role="menu"');
    expect(actions).toContain('role="menuitem"');
    expect(actions).toContain('aria-haspopup="menu"');
    expect(actions).toContain("aria-expanded={menuOpen}");
    expect(actions).toContain('"Escape"');
    expect(actions).toContain('"ArrowDown"');
    expect(actions).toContain('"ArrowUp"');
    expect(actions).toContain("focus()");
    expect(actions).toContain("addEventListener(\"pointerdown\"");
    // Opening only sets state; the fetch happens in runAction.
    expect(actions).toMatch(/onClick=\{\(\) => setMenuOpen\(\(value\) => !value\)\}/);
    // Every item carries an outline icon on the shared stroke grid.
    expect(actions.match(/<MenuGlyph>/g)?.length).toBeGreaterThanOrEqual(6);
    expect(actions).not.toMatch(/react-icons|lucide|heroicons|@iconify/);
  });

  it("guards mutations and speaks pending and failed states", async () => {
    const actions = await read(ACTIONS);

    // One fetch per action to the lifecycle endpoints.
    expect(actions).toContain("/api/staff/answer-rules/${rule.id}/${kind}");
    // Repeat clicks while a mutation is in flight do nothing.
    expect(actions).toMatch(/if \(pending !== null\) \{\s*\n\s*\/\/ One mutation in flight/);
    // Pending and error notes are live regions in the footer.
    expect(actions).toMatch(/role="status"/);
    expect(actions).toContain("data-error");
  });

  it("keeps the new controls at the 44px touch floor", async () => {
    const css = await read(CSS);

    // The verification box's floor applies to everything new in this
    // ticket: the three-dot trigger and its menu items.
    expect(css).toMatch(/\.answersMenuButton \{[^}]*min-height: 44px/s);
    expect(css).toMatch(/\.answersMenuItem \{[^}]*min-height: 44px/s);
  });

  it("confirms permanent deletion through the shared dialog, naming the answer", async () => {
    const actions = await read(ACTIONS);
    const dialog = await read("src/app/dashboard/confirm-dialog.tsx");

    expect(actions).toContain("ConfirmDialog");
    expect(actions).toContain("Permanently delete this answer?");
    // The dialog names the answer and cancel keeps it.
    expect(actions).toContain("&ldquo;{rule.topic}&rdquo;");
    expect(actions).toContain("setConfirmingPurge(false)");
    // The dashboard never uses the browser's own confirm popup (ticket 51).
    expect(actions).not.toContain("window.confirm");
    expect(dialog).toContain('role="dialog"');
  });
});

describe("the lifecycle views (ticket 58)", () => {
  it("keeps Archived and Trash out of the normal lists", async () => {
    const { filterAnswerRules } = await import("../src/app/dashboard/answers/answers-workspace");
    const rules = [
      rule("live", "published"),
      rule("drafty", "draft"),
      rule("shelved", "archived"),
      rule("binned", "trashed"),
    ];

    // "all" — and an unknown value — mean the active answers only.
    expect(filterAnswerRules(rules, "", "all").map((r) => r.id)).toEqual(["live", "drafty"]);
    expect(filterAnswerRules(rules, "", "everything" as "all").map((r) => r.id)).toEqual([
      "live",
      "drafty",
    ]);
    expect(filterAnswerRules(rules, "", "published").map((r) => r.id)).toEqual(["live"]);
    expect(filterAnswerRules(rules, "", "draft").map((r) => r.id)).toEqual(["drafty"]);
    expect(filterAnswerRules(rules, "", "archived").map((r) => r.id)).toEqual(["shelved"]);
    expect(filterAnswerRules(rules, "", "trash").map((r) => r.id)).toEqual(["binned"]);
    // Search composes with the views.
    expect(filterAnswerRules(rules, "shelved", "archived").map((r) => r.id)).toEqual(["shelved"]);
    expect(filterAnswerRules(rules, "shelved", "all")).toEqual([]);
  });

  it("offers the deliberate views in the filter with their own empty states", async () => {
    const workspace = await read(WORKSPACE);

    expect(workspace).toContain('<option value="archived">Archived</option>');
    expect(workspace).toContain('<option value="trash">Trash</option>');
    expect(workspace).toContain("No archived answers.");
    expect(workspace).toContain("Trash is empty.");
    expect(workspace).toContain("No active answers.");
    // The pinned earlier states survive.
    expect(workspace).toContain("No draft answers yet.");
    expect(workspace).toContain("No published answers yet.");
  });

  it("updates the page in place from the menu's results", async () => {
    const workspace = await read(WORKSPACE);

    // The rules live in state; each action's response replaces or adds a
    // rule without a reload.
    expect(workspace).toContain("useState(initialRules)");
    expect(workspace).toContain("handleUpdated");
    expect(workspace).toContain("handleCreated");
    expect(workspace).toContain("handleRemoved");
    expect(workspace).toMatch(/byRecentFirst/);
  });
});

describe("the reference card treatment (ticket 58)", () => {
  it("highlights the expanded card and pills the metadata", async () => {
    const css = await read(CSS);
    const workspace = await read(WORKSPACE);

    // The open card gets the strong blue border treatment.
    expect(css).toMatch(/\.answersCard\[data-open\] \{[^}]*border-color: var\(--sfc-blue\)/s);
    expect(css).toMatch(/\.answersCard\[data-open\] \{[^}]*box-shadow/s);
    // Meta pills are outlined; the footer trail stays plain text.
    expect(css).toMatch(/\.answersMetaPill \{[^}]*border: 1px solid var\(--line\)/s);
    expect(css).toMatch(/\.answersMetaPill \{[^}]*border-radius: var\(--radius-pill\)/s);
    expect(workspace).toContain("answersMetaPill");
    // The card pills render in both states (collapsed row + expanded row);
    // the toggle's copy stands down when open so the reference's expanded
    // order — response, pills, divider, footer — holds.
    expect(css).toMatch(/\.answersCard\[data-open\] \.answersCardToggle \.answersCardMeta \{\s*display: none;/s);
  });

  it("labels the lifecycle states honestly", async () => {
    const workspace = await read(WORKSPACE);

    expect(workspace).toContain("archivedBadge");
    expect(workspace).toContain("trashedBadge");
    expect(workspace).toContain("In Trash");
    expect(workspace).toContain("Archived · last edited");
    // The expanded card's footer actions carry the reference's label.
    const actions = await read(ACTIONS);
    expect(actions).toContain("Edit answer");
  });

  it("aligns the answers content on one wide grid", async () => {
    const css = await read(CSS);
    const page = await read(PAGE);

    // The page wraps its content in the scrolling column and the wide grid.
    expect(page).toContain("styles.contentArea");
    expect(page).toContain("answersPage");
    expect(css).toMatch(/\.answersPage \{[^}]*max-width: 6\wrem/s);
    expect(css).toMatch(/\.answersPage \{[^}]*flex-direction: column/s);
    // No centered .inbox wrapper remains on the answers page itself.
    expect(page).not.toContain("styles.inbox");
  });
});
