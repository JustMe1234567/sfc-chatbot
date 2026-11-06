import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/paths";

const CSS = "src/app/dashboard/dashboard.module.css";
const HEADER = "src/app/dashboard/header.tsx";
const DESK = "src/app/dashboard/inbox/conversation-desk.tsx";

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(repoRoot(), relativePath), "utf8");
}

describe("the bounded conversation desk (ticket 63)", () => {
  it("aligns only the conversation heading to the desk width", async () => {
    const header = await read(HEADER);
    const css = await read(CSS);

    expect(header).toContain('data-desk-heading={area === "inbox" || undefined}');
    expect(css).toMatch(/\.contentHead\[data-desk-heading\] \{[^}]*max-width: 72rem/s);
    expect(css).toMatch(/\.contentHead\[data-desk-heading\] \{[^}]*width: calc\(100% - 48px\)/s);
  });

  it("keeps matching desktop panes inside the available content height", async () => {
    const css = await read(CSS);

    expect(css).toMatch(/\.desk \{[^}]*height: 100%/s);
    expect(css).toMatch(/\.desk \{[^}]*min-height: 0/s);
    expect(css).toMatch(/\.deskList \{[^}]*min-height: 0/s);
    expect(css).toMatch(/\.deskList \{[^}]*overflow-y: auto/s);
    expect(css).toMatch(/\.deskPane \{[^}]*min-height: 0/s);
    expect(css).toMatch(/\.deskPane \{[^}]*overflow: hidden/s);
  });

  it("scrolls the bordered transcript without moving its controls", async () => {
    const css = await read(CSS);
    const desk = await read(DESK);

    expect(css).toMatch(/\.paneBody \{[^}]*min-height: 0/s);
    expect(css).toMatch(/\.paneBody \.transcript \{[^}]*overflow-y: auto/s);
    expect(css).toMatch(/\.paneBody \.transcript \{[^}]*border: 1px solid var\(--line\)/s);
    expect(desk).toContain('className={styles.transcript} tabIndex={0} aria-label="Messages"');
  });

  it("returns to the existing stacked document flow on narrow screens", async () => {
    const css = await read(CSS);
    const narrow = css.slice(css.indexOf("@media (max-width: 760px)"));

    expect(narrow).toMatch(/\.desk \{[^}]*height: auto/s);
    expect(narrow).toMatch(/\.deskPane \{[^}]*min-height: 60vh/s);
    expect(narrow).toMatch(/\.deskPane \{[^}]*overflow: visible/s);
  });
});
