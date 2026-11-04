import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/paths";

const PAGE = "src/app/dashboard/notifications/page.tsx";
const CSS = "src/app/dashboard/dashboard.module.css";

/**
 * Ticket 49: the Email alerts dashboard's information architecture — the
 * delivery-setup intro, the balanced settings grid, the compact delivery
 * history with semantic badges and totals, and the empty state. The ticket
 * is presentation-only: these pins sit next to the preserved form endpoints
 * so a redesign cannot silently move behavior.
 */
describe("email alerts dashboard structure (ticket 49)", () => {
  it("keeps the delivery-setup and delivery-history sections with their intro copy", async () => {
    const source = await readFile(path.join(repoRoot(), PAGE), "utf8");
    expect(source).toContain('aria-labelledby="delivery-settings-title"');
    expect(source).toContain('aria-labelledby="delivery-history-title"');
    expect(source).toContain("Delivery setup");
    expect(source).toContain("Delivery history");
    // The settings grid holds the three owner cards; non-owners get the
    // read-only summary (permissions unchanged).
    expect(source).toContain("alertSettingsGrid");
    expect(source).toContain("alertSummaryGrid");
    expect(source).toContain('guard.staff.role === "owner"');
  });

  it("renders semantic status badges with visible text, not color alone", async () => {
    const source = await readFile(path.join(repoRoot(), PAGE), "utf8");
    expect(source).toContain('"Delivered"');
    expect(source).toContain('"Failed"');
    expect(source).toContain('"Pending"');
    expect(source).toContain("alertStatusSent");
    expect(source).toContain("alertStatusFailed");
    expect(source).toContain("alertStatusPending");
  });

  it("summarizes delivery totals and shows the empty state", async () => {
    const source = await readFile(path.join(repoRoot(), PAGE), "utf8");
    expect(source).toContain('aria-label="Delivery totals"');
    expect(source).toContain("delivered");
    // The failed count is conditional: no failures, no failed pill.
    expect(source).toContain("failedCount > 0");
    expect(source).toContain("alertEmpty");
    expect(source).toContain("New handoff alerts will appear here");
    // Delivered must not promise a human read the visitor's copy over.
    expect(source).toContain("confirm the recipient read it.");
  });

  it("shows retry only on failed deliveries", async () => {
    const source = await readFile(path.join(repoRoot(), PAGE), "utf8");
    expect(source).toContain('notification.status !== "sent"');
    const retry = await readFile(
      path.join(repoRoot(), "src/app/dashboard/notifications/retry-button.tsx"),
      "utf8",
    );
    // The retry button carries a real class (the pre-redesign page pointed
    // at a nonexistent one and rendered unstyled).
    expect(retry).toContain("styles.retryButton");
    expect(retry).not.toContain("styles.signOut");
  });

  it("meets the 44px touch-target floor for the day picker and retry", async () => {
    const css = await readFile(path.join(repoRoot(), CSS), "utf8");
    expect(css).toMatch(/\.dayChoice span \{[^}]*min-height: 44px/s);
    expect(css).toMatch(/\.retryButton \{[^}]*min-height: 44px/s);
  });

  it("preserves the three settings APIs the forms submit to", async () => {
    for (const [file, endpoint, body] of [
      [
        "src/app/dashboard/notifications/support-hours-form.tsx",
        "/api/staff/settings/support-hours",
        "JSON.stringify({ hours })",
      ] as const,
      [
        "src/app/dashboard/notifications/alert-settings-form.tsx",
        "/api/staff/settings/alert-recipients",
        "JSON.stringify({ recipients })",
      ] as const,
      [
        "src/app/dashboard/notifications/retention-form.tsx",
        "/api/staff/settings/transcript-retention",
        "JSON.stringify({ days: period })",
      ] as const,
    ]) {
      const source = await readFile(path.join(repoRoot(), file), "utf8");
      expect(source, file).toContain(endpoint);
      expect(source, file).toContain(body);
    }
  });

  it("uses no emoji as structural icons on the alerts page", async () => {
    const source = await readFile(path.join(repoRoot(), PAGE), "utf8");
    expect(source).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});
