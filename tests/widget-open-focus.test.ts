import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/paths";

/**
 * Ticket 26: keyboard focus on widget open. Source-level pins for the
 * loader and the frame app; the live behavior is certified by
 * scripts/cert26-widget-focus.mjs (screenshots in
 * .scratch/college-website-chat/references/ticket26). Lives in its own
 * file because embed-smoke.test.ts is occupied by a concurrent ticket.
 */
describe("widget focus on open (ticket 26)", () => {
  it("sends the opener's modality with the panel state", async () => {
    const script = await readFile(path.join(repoRoot(), "public/widget/v1.js"), "utf8");
    const source = await readFile(path.join(repoRoot(), "src/widget/loader.ts"), "utf8");
    // The frame document has no interaction history of its own, so the
    // :focus-visible heuristic cannot know how the open was triggered: the
    // launcher records pointer vs keyboard and the state message carries it.
    expect(source).toContain('launcher.addEventListener("pointerdown"');
    expect(source).toContain('launcher.addEventListener("keydown"');
    expect(source).toMatch(/viaKeyboard: openViaKeyboard/);
    expect(script).toContain("viaKeyboard");
  });

  it("focuses a deliberate target on every open, ring pinned to modality", async () => {
    // Ticket 33 moved the handshake and focus into the frame's panel-state
    // hook; the pin follows the code.
    const panel = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/hooks/usePanelState.ts"),
      "utf8",
    );
    const frame = await readFile(
      path.join(repoRoot(), "src/app/widget/frame/page.tsx"),
      "utf8",
    );
    // The composer when it is usable (the contact gate or the waiting lock
    // route to the close button), on every open — not just first load.
    expect(panel).toMatch(/function focusPanelTarget\(/);
    expect(panel).toMatch(/if \(input && !input\.disabled\)/);
    expect(panel).toMatch(/closeButtonRef\.current\?\.focus\(focusOptions\)/);
    expect(panel).toMatch(/focusPanelTarget\(event\.data\.viaKeyboard === true\)/);
    // The standalone preview is the open panel too.
    expect(panel).toContain("focusPanelTarget(false);");
    // Both mutually exclusive header variants feed the same fallback ref.
    expect((frame.match(/ref=\{closeButtonRef\}/g) ?? []).length).toBe(2);
  });

  it("keeps the close-to-launcher focus return untouched", async () => {
    const source = await readFile(path.join(repoRoot(), "src/widget/loader.ts"), "utf8");
    expect(source).toMatch(/launcher\.focus\(\)/);
  });
});
