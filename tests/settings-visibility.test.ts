import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/paths";
import { TEST_ORIGIN, useTempDatabase, warmChatbotService } from "./helpers";
import { CookieJar, provisionStaff, signInAs } from "./auth-helpers";

const STAFF_EMAIL = "helper@example.edu";
const STAFF_PASSWORD = "helper-visits-lantern-8f";
const EDITOR_EMAIL = "editor@example.edu";
const EDITOR_PASSWORD = "editor-visits-orbit-3c";

async function read(rel: string): Promise<string> {
  return readFile(path.join(repoRoot(), rel), "utf8");
}

async function settingsGet(jar: CookieJar, route: string): Promise<Response> {
  const module = await import(`../src/app/api/staff/settings/${route}/route`);
  return module.GET(
    new Request(`${TEST_ORIGIN}/api/staff/settings/${route}`, {
      headers: { cookie: jar.header() },
    }),
  );
}

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await warmChatbotService();
  await provisionStaff({ email: STAFF_EMAIL, password: STAFF_PASSWORD, name: "Sasha" });
  await provisionStaff({ email: EDITOR_EMAIL, password: EDITOR_PASSWORD, name: "Elif", role: "editor" });
});

/**
 * Ticket 88: the notifications-page removal silently tightened support-hours
 * and transcript-retention visibility to owner-only. The settings page
 * restores the settled posture from tickets 09/10 — owners edit through the
 * forms, staff keep a read-only summary, editors see neither — while the
 * APIs stay owner-only.
 */
describe("the settings page shows each role its own surface (ticket 88)", () => {
  it("keeps the owner-only configuration cards inside the owner branch", async () => {
    const page = await read("src/app/dashboard/settings/page.tsx");
    expect(page).toContain('guard.staff.role === "owner"');
    // The four owner cards render only through that conditional: the page
    // has exactly one owner branch and one staff branch and no editor
    // branch, so editors structurally cannot see either surface.
    expect(page.match(/guard\.staff\.role === "owner"/g)?.length).toBe(1);
    expect(page.match(/guard\.staff\.role === "staff"/g)?.length).toBe(1);
    expect(page).not.toContain('guard.staff.role === "editor"');
    for (const card of [
      "SupportHoursForm",
      "RetentionForm",
      "LoginRetentionForm",
      "EmbedAllowlistSettings",
    ]) {
      expect(page).toContain(card);
    }
    const ownerBranch = page.slice(page.indexOf('guard.staff.role === "owner"'), page.indexOf('guard.staff.role === "staff"'));
    for (const card of [
      "SupportHoursForm",
      "RetentionForm",
      "LoginRetentionForm",
      "EmbedAllowlistSettings",
    ]) {
      expect(ownerBranch).toContain(card);
    }
  });

  it("restores the staff read-only summary the notifications page carried", async () => {
    const page = await read("src/app/dashboard/settings/page.tsx");
    const staffBranch = page.slice(page.indexOf('guard.staff.role === "staff"'));
    expect(staffBranch).toContain("alertSummaryGrid");
    expect(staffBranch).toContain("<dt>Support hours</dt>");
    expect(staffBranch).toContain("<dt>Transcript retention</dt>");
    expect(staffBranch).toContain("scheduleSummary(supportHours)");
    expect(staffBranch).toContain("Not configured; visitors receive the general follow-up message.");
    expect(staffBranch).toContain("DEFAULT_RETENTION_DAYS");
    // Read-only: the staff branch renders no form component at all.
    for (const form of [
      "SupportHoursForm",
      "RetentionForm",
      "LoginRetentionForm",
      "EmbedAllowlistSettings",
    ]) {
      expect(staffBranch).not.toContain(form);
    }
  });

  it("refuses staff and editors on both settings APIs they may not read", async () => {
    const staffJar = new CookieJar();
    await signInAs(staffJar, STAFF_EMAIL, STAFF_PASSWORD);
    expect((await settingsGet(staffJar, "support-hours")).status).toBe(403);
    expect((await settingsGet(staffJar, "transcript-retention")).status).toBe(403);

    const editorJar = new CookieJar();
    await signInAs(editorJar, EDITOR_EMAIL, EDITOR_PASSWORD);
    expect((await settingsGet(editorJar, "support-hours")).status).toBe(403);
    expect((await settingsGet(editorJar, "transcript-retention")).status).toBe(403);
  });
});
