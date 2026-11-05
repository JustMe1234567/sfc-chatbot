import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/paths";

/**
 * Ticket 57: the sidebar's desktop default is the compact icon rail, and a
 * hovered or focused row shows exactly one callout — its own label — beside
 * the rail. The rail's expand preference, drawer, role filtering, and
 * navigation semantics are ticket 52's and stay.
 */

const HEADER = "src/app/dashboard/header.tsx";
const CSS = "src/app/dashboard/dashboard.module.css";

describe("the compact-by-default rail (ticket 57)", () => {
  it("renders collapsed by default and expands only on the explicit marker", async () => {
    const header = await readFile(path.join(repoRoot(), HEADER), "utf8");

    // The server render and hydration agree on compact; no flash for staff
    // without a saved preference.
    expect(header).toContain("useState(true)");
    // Only the exact expanded marker (written on expand) restores labels;
    // missing, "1", or stale junk stays compact.
    expect(header).toMatch(/getItem\([^)]*\) === "0"/);
    expect(header).not.toMatch(/getItem\([^)]*\) === "1"/);
    // The expand control and persisted preference survive from ticket 52.
    expect(header).toContain('aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}');
    expect(header).toContain("COLLAPSED_KEY");
  });
});

describe("the one-at-a-time callout (ticket 57)", () => {
  it("shows only the hovered or focused row's label, from state", async () => {
    const header = await readFile(path.join(repoRoot(), HEADER), "utf8");

    // One piece of callout state per rail: moving rows replaces it, leaving
    // dismisses it, and expanding the rail clears it.
    expect(header).toContain("setCallout(null)");
    expect(header).toMatch(/useEffect\(\(\) => \{[^}]*setCallout\(null\);[^}]*\}, \[collapsed\]\)/s);
    // Rows show their label on hover AND keyboard focus, only while compact.
    expect(header).toContain("onMouseEnter");
    expect(header).toContain("onFocus");
    expect(header).toContain("if (!collapsed)");
    // A nav scroll under a stationary pointer dismisses the callout rather
    // than leaving it detached from its row.
    expect(header).toContain("onScroll");
    // One callout element, rendered only in the compact rail.
    expect(header).toMatch(/collapsed && callout \?/);
    expect(header.match(/className=\{styles\.sideTip\}/g)?.length).toBe(1);
  });

  it("keeps the callout decorative, visible, and clamped to the viewport", async () => {
    const header = await readFile(path.join(repoRoot(), HEADER), "utf8");

    // The label duplicates the link's accessible name: aria-hidden, no
    // pointer events, fixed positioning clear of the rail and scroll clips.
    expect(header).toContain('aria-hidden="true"');
    expect(header).toContain('data-open=""');
    // First and last rows stay inside the viewport.
    expect(header).toContain("window.innerHeight");
    expect(header).toMatch(/Math\.max\(/);
    expect(header).toMatch(/Math\.min\(/);
  });

  it("gives Sign out the same individual label in compact mode", async () => {
    const header = await readFile(path.join(repoRoot(), HEADER), "utf8");

    expect(header).toContain('calloutProps("Sign out")');
    expect(header).toContain("sideSignOutWrap");
    // The pending sign-out state and duplicate-submission guard live in the
    // button and are untouched.
    const signOut = await readFile(
      path.join(repoRoot(), "src/app/dashboard/inbox/sign-out-button.tsx"),
      "utf8",
    );
    expect(signOut).toContain('pendingLabel="Signing out…"');
    expect(signOut).toContain("signOutPending");
  });

  it("leaves the expanded rail and the mobile drawer label-driven", async () => {
    const header = await readFile(path.join(repoRoot(), HEADER), "utf8");

    // The drawer renders with collapsed={false}: no callouts there.
    expect(header).toContain("collapsed={false}");
    // Visible labels return when the rail is expanded.
    expect(header).toContain('className={styles.sideLabel}');
  });
});

describe("the callout styles (ticket 57)", () => {
  it("floats the callout outside the rail with a pointer, unclipped", async () => {
    const css = await readFile(path.join(repoRoot(), CSS), "utf8");

    // Position: fixed escapes the rail's and nav's overflow clipping, above
    // the page and below the drawer layers.
    expect(css).toMatch(/\.sideTip \{[^}]*position: fixed/s);
    expect(css).toMatch(/\.sideTip \{[^}]*pointer-events: none/s);
    expect(css).toMatch(/\.sideTip \{[^}]*z-index: 65/s);
    // Shown only through the state-driven marker (the old CSS hover
    // selectors are gone — hover/focus are handled in the component).
    expect(css).toMatch(/\.sideTip\[data-open\]/);
    expect(css).not.toMatch(/\.sideItem:hover \.sideTip/);
    // The callout reads as a bubble with a pointer toward the rail.
    expect(css).toMatch(/\.sideTip::before|\.sideTip::after/);
    // Reduced motion is respected by having no entrance animation at all:
    // the callout toggles display, so pin that no untokened transition
    // sneaks in later.
    expect(css).not.toMatch(/\.sideTip \{[^}]*transition/);
    // The sign-out wrapper is a block so its hover area is the full row.
    expect(css).toMatch(/\.sideSignOutWrap \{[^}]*display: block/s);
    // Row targets keep the 44px floor.
    expect(css).toMatch(/\.sideItem \{[^}]*min-height: 44px/s);
  });
});
