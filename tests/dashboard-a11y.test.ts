import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/paths";

/**
 * Ticket 28: dashboard a11y. The staff transcript (re-rendered every 3s by
 * the authorized poll) must be a live region so a screen-reader staff member
 * hears a visitor's reply; the analytics period switch, which already
 * promises tab semantics with aria-selected, must complete the tabs pattern
 * (owned panel, aria-controls, roving tabindex, arrow-key navigation) rather
 * than keep promising keyboard behavior that does not exist.
 */
describe("dashboard a11y (ticket 28)", () => {
  it("makes the desk transcript a polite live region", async () => {
    const source = await readFile(
      path.join(repoRoot(), "src/app/dashboard/inbox/conversation-desk.tsx"),
      "utf8",
    );
    // role="log" is the live region for chronological message streams; the
    // explicit aria-live keeps older screen-reader combinations covered (the
    // visitor widget's transcript pairs the same two).
    const transcriptStart = source.indexOf('className={styles.transcript}');
    expect(transcriptStart).toBeGreaterThan(-1);
    const transcriptSlice = source.slice(transcriptStart, source.indexOf(">", transcriptStart));
    expect(transcriptSlice).toContain('role="log"');
    expect(transcriptSlice).toContain('aria-live="polite"');
    // Announcements only make sense while polled re-renders append nodes
    // instead of replacing the stream: the message list keys on the stable
    // message id.
    expect(source).toContain("key={message.id}");
  });

  it("completes the analytics period switch as a real tabs pattern", async () => {
    const source = await readFile(
      path.join(repoRoot(), "src/app/dashboard/analytics/analytics-view.tsx"),
      "utf8",
    );
    // Tabs own their panel and name it for assistive tech.
    expect(source).toContain('id={`analytics-tab-${option.key}`}');
    expect(source).toContain('aria-controls="analytics-panel"');
    expect(source).toMatch(/role="tabpanel"[\s\S]*?id="analytics-panel"/);
    expect(source).toMatch(/aria-labelledby=\{`analytics-tab-\$\{period\}`\}/);
    // Roving tabindex: one tab stop into the tablist, arrows move both
    // selection and focus (wrap included), Home/End jump to the ends.
    expect(source).toContain("tabIndex={option.key === period ? 0 : -1}");
    expect(source).toContain('"ArrowRight"');
    expect(source).toContain('"ArrowLeft"');
    expect(source).toContain('"Home"');
    expect(source).toContain('"End"');
    // The poll cannot stack behind an in-flight report load; arrows stand
    // down with the buttons while one is running.
    expect(source).toMatch(/if \(loading\)[\s\S]{0,200}return/);
  });
});
