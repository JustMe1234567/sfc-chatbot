import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/paths";

/**
 * Ticket 60: the sidebar rail's icon polish — collapsed rows become true
 * 44px squares with their marks dead-center (the row's padding, gap, and
 * start-justification stand down), the expand/collapse control joins
 * ticket 57's hover-callout system, and the icon rhythm tightens (2px row
 * gaps, no block padding). The control-first DOM order is pinned in
 * answers-lifecycle-ui.test.ts, where the superseded ticket-58 placement
 * pin lived. Presentation only: the aria contract, persistence, roles,
 * drawer, and expanded hierarchy stay.
 */

const HEADER = "src/app/dashboard/header.tsx";
const CSS = "src/app/dashboard/dashboard.module.css";
const PREFERENCE = "src/app/dashboard/sidebar-preference.ts";

describe("the relocated control joins the callout system (ticket 60)", () => {
  it("gives the toggle the rail's hover callout on its swapped name", async () => {
    const header = await readFile(path.join(repoRoot(), HEADER), "utf8");
    // Sitting among the icon-only rows, the toggle now behaves like them:
    // hover or focus shows its label beside the rail (ticket 57's
    // one-callout system). Its swapped accessible name lives in the
    // shared toggleLabel (pinned in answers-lifecycle-ui), so the callout
    // names exactly what the button announces; its own state pin stays.
    expect(header).toContain("aria-expanded={!collapsed}");
    expect(header).toContain("{...calloutProps(toggleLabel)}");
  });
});

describe("collapsed rows are true centered squares (ticket 60)", () => {
  it("collapses each nav row to a 44px tile with the mark centered", async () => {
    const css = await readFile(path.join(repoRoot(), CSS), "utf8");
    // A true square on both axes, centered in the rail.
    expect(css).toMatch(/\.sidebar\[data-collapsed\] \.sideItem \{[^}]*width: 44px/s);
    expect(css).toMatch(/\.sidebar\[data-collapsed\] \.sideItem \{[^}]*align-self: center/s);
    // The mark centers because the row's padding, flex gap, and
    // start-justification all stand down: the base row stretches to the
    // rail's inner width and insets the mark by horizontal padding — a
    // 48×44 rectangle with the icon pushed off the tile's center line.
    expect(css).toMatch(/\.sidebar\[data-collapsed\] \.sideItem \{[^}]*padding: 0/s);
    expect(css).toMatch(/\.sidebar\[data-collapsed\] \.sideItem \{[^}]*gap: 0/s);
    expect(css).toMatch(/\.sidebar\[data-collapsed\] \.sideItem \{[^}]*justify-content: center/s);
  });

  it("gives the relocated toggle the same collapsed square", async () => {
    const css = await readFile(path.join(repoRoot(), CSS), "utf8");
    expect(css).toMatch(/\.sidebar\[data-collapsed\] \.sideToggle \{[^}]*width: 44px/s);
    expect(css).toMatch(/\.sidebar\[data-collapsed\] \.sideToggle \{[^}]*align-self: center/s);
    // Its own 44px floors from tickets 52/57 hold in the base rule.
    expect(css).toMatch(/\.sideToggle \{[^}]*min-height: 44px/s);
    expect(css).toMatch(/\.sideToggle \{[^}]*min-width: 44px/s);
  });
});

describe("the icon rhythm tightens (ticket 60)", () => {
  it("drops the nav's row gap and the rows' block padding", async () => {
    const css = await readFile(path.join(repoRoot(), CSS), "utf8");
    expect(css).toMatch(/\.sideNav \{[^}]*gap: 2px/s);
    // Horizontal-only padding: the 44px min-height and center alignment
    // already own vertical centering, so block padding just added air.
    expect(css).toMatch(/\.sideItem \{[^}]*padding: 0 10px/s);
    expect(css).not.toMatch(/\.sideItem \{[^}]*padding: 8px/s);
  });

  it("keeps the touch floors and the expanded rail's readability", async () => {
    const css = await readFile(path.join(repoRoot(), CSS), "utf8");
    // The 44px floor holds in both states.
    expect(css).toMatch(/\.sideItem \{[^}]*min-height: 44px/s);
    // The expanded rows keep their label inset and icon-to-label gap.
    expect(css).toMatch(/\.sideItem \{[^}]*gap: 10px/s);
    // Hover feedback still animates colors only (ticket 15).
    expect(css).toMatch(
      /\.sideItem,[\s\S]{0,400}?transition: background-color var\(--motion-fast\)/,
    );
  });
});

describe("nothing else about the rail moves (ticket 60)", () => {
  it("keeps compact-by-default, the drawer, and the nav contract", async () => {
    const header = await readFile(path.join(repoRoot(), HEADER), "utf8");
    const preference = await readFile(path.join(repoRoot(), PREFERENCE), "utf8");
    expect(header).toContain("useState(initialSidebarCollapsed)");
    expect(preference).toContain("return sessionCollapsed ?? true");
    expect(preference).toContain("COLLAPSED_KEY");
    expect(header).toContain("collapsed={false}");
    // Role filtering is the NAV seam other tickets coordinate against
    // (roles rewritten by ticket 102).
    expect(header).toContain(
      '{ area: "inbox", href: "/dashboard/inbox", label: "Conversations", roles: ["admin", "admissions_advisor"] }',
    );
    expect(header).toMatch(/Record<HeaderArea/);
  });
});
