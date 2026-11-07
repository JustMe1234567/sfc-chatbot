import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/paths";

const HEADER = "src/app/dashboard/header.tsx";
const CSS = "src/app/dashboard/dashboard.module.css";
const PREFERENCE = "src/app/dashboard/sidebar-preference.ts";

/**
 * Ticket 52: the dashboard's top navigation bar becomes a collapsible dark
 * left sidebar, built entirely inside DashboardHeader so its prop contract
 * (area/title/name/role) — and therefore every page — stays untouched.
 */

async function readHeader(): Promise<string> {
  return readFile(path.join(repoRoot(), HEADER), "utf8");
}

describe("the sidebar keeps the navigation contract (ticket 52)", () => {
  it("keeps the exact hrefs, labels, and role filtering of the existing areas", async () => {
    const header = await readHeader();
    // The NAV table is the single seam ticket 53 coordinates against: labels,
    // hrefs, and role subsets must be byte-identical to the top bar's.
    // Ticket 53 adds its own sixth entry (Visitor emails) without touching
    // these five rows.
    for (const row of [
      '{ area: "inbox", href: "/dashboard/inbox", label: "Conversations", roles: ["owner", "staff"] }',
      '{ area: "analytics", href: "/dashboard/analytics", label: "Analytics", roles: ["owner", "staff"] }',
      '{ area: "answers", href: "/dashboard/answers", label: "Answers", roles: ["owner", "editor"] }',
      '{ area: "staff", href: "/dashboard/staff", label: "Staff", roles: ["owner"] }',
      '{ area: "alerts", href: "/dashboard/notifications", label: "Email alerts", roles: ["owner", "staff"] }',
    ]) {
      expect(header, row).toContain(row);
    }
    // Active area tracking matches the top bar exactly.
    expect(header).toContain('aria-current={item.area === area ? "page" : undefined}');
    expect(header).toContain('aria-label="Dashboard"');
  });

  it("renders a hand-authored inline SVG icon per area, with no icon library", async () => {
    const header = await readHeader();
    // One shared Mark wrapper renders the inline SVG; the six area entries
    // (ticket 53 added the envelope) supply their own paths, plus the
    // toggle chevron and menu marks.
    const marks = (header.match(/<Mark>/g) ?? []).length;
    expect(marks).toBe(6);
    expect(header).toMatch(/function Mark/);
    // Icons inherit color — no fills that ignore currentColor.
    expect(header).not.toMatch(/fill="#(?!none)/);
    // No icon dependency is added.
    expect(header).not.toMatch(/react-icons|lucide|heroicons|@iconify|@mui\/icons/);
    // The rendered icon must follow the active area, not be a single fixed
    // mark: the per-area icon is selected from a map keyed by area id.
    expect(header).toMatch(/Record<HeaderArea/);
    // Sign out carries the arrow mark on the same grid.
    expect(header).toContain("SIGN_OUT_MARK");
  });

  it("persists the collapse choice and falls back to compact (ticket 57)", async () => {
    const header = await readHeader();
    const preference = await readFile(path.join(repoRoot(), PREFERENCE), "utf8");
    expect(preference).toContain("dashboard.sidebar.collapsed");
    // Ticket 57 makes the compact rail the desktop default: only the exact
    // expanded marker ("0", written on expand) restores labels; anything
    // else — missing, "1", or a stale junk value — stays compact. (Ticket
    // 52 stored "1" for collapsed; those staff keep the same rail.)
    expect(preference).toMatch(/getItem\([^)]*\) !== "0"/);
    expect(header).toContain("restoreSidebarCollapsed(window.localStorage)");
    expect(header).toMatch(/catch/);
  });

  it("moves the page title into a content-area heading", async () => {
    const header = await readHeader();
    // The brand block no longer carries the h1; the content head does.
    expect(header).toContain("contentTitle");
    expect(header.indexOf("<h1")).toBeGreaterThan(header.indexOf("contentHead"));
    // The rail keeps the brand mark — the reference's crest-alone block
    // (ticket 58): larger and centered over a divider, with no wordmark.
    expect(header).toContain("/brand/cropped-SFC-Final-Logo-Single.png");
    expect(header).not.toContain("sideCollege");
  });
});

describe("the drawer replaces the rail on narrow screens (ticket 52)", () => {
  it("opens from a header control with scrim, Escape, and close-on-navigate", async () => {
    const header = await readHeader();
    // The drawer control announces itself and tracks its own state.
    expect(header).toMatch(/aria-expanded=\{drawerOpen/);
    expect(header).toMatch(/aria-controls/);
    // A scrim closes it; Escape closes it; navigating closes it.
    expect(header).toMatch(/scrim/i);
    expect(header).toContain('"Escape"');
    expect(header).toMatch(/closeDrawer\(\)/);
  });
});

describe("the sidebar styles stay in the dashboard token system (ticket 52)", () => {
  it("grids the shell into rail plus content and animates the rail", async () => {
    const css = await readFile(path.join(repoRoot(), CSS), "utf8");
    // The shell becomes sidebar column + content column.
    expect(css).toMatch(/\.shell \{[^}]*grid-template-columns: auto minmax\(0, 1fr\)/s);
    // Expanded and collapsed rail widths, animated via the motion tokens.
    expect(css).toMatch(/--sidebar-width: 2\d\dpx/);
    expect(css).toMatch(/--sidebar-width: 6\dpx/);
    expect(css).toMatch(/\.sidebar \{[^}]*width: var\(--sidebar-width\)/s);
    expect(css).toMatch(/\.sidebar \{[^}]*transition: width var\(--motion-base\)/s);
    // Nav rows are comfortable touch targets in both states.
    expect(css).toMatch(/\.sideItem \{[^}]*min-height: 44px/s);
  });

  it("shows the callout only while collapsed, driven by state (ticket 57)", async () => {
    const css = await readFile(path.join(repoRoot(), CSS), "utf8");
    // Hidden unless the component's data-open marker is present: hover and
    // focus are handled in the component (ticket 57), so the CSS keeps no
    // per-row hover selectors — one callout, never several.
    expect(css).toMatch(/\.sideTip \{[^}]*display: none/s);
    expect(css).toMatch(/\.sideTip\[data-open\]/);
    expect(css).not.toMatch(/\.sideItem:hover \.sideTip/);
  });

  it("swaps the rail for the drawer at narrow widths", async () => {
    const css = await readFile(path.join(repoRoot(), CSS), "utf8");
    expect(css).toMatch(/@media \(max-width: 720px\) \{/);
    const narrow = css.slice(css.indexOf("@media (max-width: 720px)"));
    expect(narrow).toMatch(/\.sidebar \{[^}]*display: none/s);
    expect(narrow).toMatch(/\.sideScrim \{/);
    expect(narrow).toMatch(/\.sideDrawer \{[^}]*position: fixed/s);
    // The narrow shell drops the two-column grid entirely.
    expect(narrow).toMatch(/\.shell \{[^}]*display: block/s);
  });

  it("leaves the old top-bar styles behind", async () => {
    const css = await readFile(path.join(repoRoot(), CSS), "utf8");
    expect(css).not.toContain(".topBar");
    expect(css).not.toContain(".topNav");
    expect(css).not.toContain(".topIdentity");
  });
});
