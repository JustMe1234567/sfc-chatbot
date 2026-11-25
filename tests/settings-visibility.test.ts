import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/paths";
import { TEST_ORIGIN, useTempDatabase, warmChatbotService } from "./helpers";
import { CookieJar, provisionStaff, signInAs } from "./auth-helpers";

const ADVISOR_EMAIL = "helper@example.edu";
const ADVISOR_PASSWORD = "helper-visits-lantern-8f";
const ADMIN_EMAIL = "admin@example.edu";
const ADMIN_PASSWORD = "admin-settings-orbit-3c";

async function read(rel: string): Promise<string> {
  return readFile(path.join(repoRoot(), rel), "utf8");
}

async function settingsRequest(
  jar: CookieJar | null,
  route: string,
  method: "GET" | "PUT" = "GET",
  body?: unknown,
): Promise<Response> {
  const module = await import(`../src/app/api/staff/settings/${route}/route`);
  return module[method](
    new Request(`${TEST_ORIGIN}/api/staff/settings/${route}`, {
      method,
      headers: {
        ...(jar ? { cookie: jar.header() } : {}),
        ...(method === "GET" ? {} : { origin: TEST_ORIGIN, "Content-Type": "application/json" }),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
}

beforeAll(async () => {
  useTempDatabase();
  process.env.CHATBOT_BASE_URL = TEST_ORIGIN;
  await warmChatbotService();
  await provisionStaff({ email: ADVISOR_EMAIL, password: ADVISOR_PASSWORD, name: "Sasha" });
  await provisionStaff({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: "Ari", role: "admin" });
});

/**
 * Ticket 102: Settings is an Admin area. Admissions Advisors have no Settings
 * page at all — branding moved to admins, and ticket 88's read-only
 * support-hours and transcript-retention summary left with the page. The
 * self-service password change moved to the dashboard chrome, where both
 * roles reach it.
 */
describe("the Settings area is admin-only (ticket 102)", () => {
  it("opens the settings page to admins alone, with no role branches left inside", async () => {
    const page = await read("src/app/dashboard/settings/page.tsx");
    expect(page).toContain('{ roles: ["admin"] }');
    expect(page).not.toContain("DASHBOARD_ROLES");
    expect(page).toContain("This page requires the admin role.");
    // Every configuration surface renders unconditionally for the admin.
    for (const card of [
      "SupportHoursForm",
      "RetentionForm",
      "LoginRetentionForm",
      "EmbedAllowlistSettings",
      "BrandingSettings",
    ]) {
      expect(page).toContain(`<${card}`);
    }
    // No role decides what the page shows any more.
    expect(page).not.toMatch(/guard\.staff\.role\s*[!=]=/);
  });

  it("no longer carries ticket 88's read-only summary or the password form", async () => {
    const page = await read("src/app/dashboard/settings/page.tsx");
    for (const gone of ["alertSummaryGrid", "<dt>Support hours</dt>", "<dt>Transcript retention</dt>", "scheduleSummary"]) {
      expect(page).not.toContain(gone);
    }
    // The password change lives in the dashboard chrome now (ticket 102).
    expect(page).not.toContain("PasswordSettings");
  });

  it("offers Settings in the navigation to admins alone", async () => {
    const header = await read("src/app/dashboard/header.tsx");
    expect(header).toContain('{ area: "settings", href: "/dashboard/settings", label: "Settings", roles: ["admin"] }');
  });

  it("refuses advisors on every configuration API and serves admins", async () => {
    const advisorJar = new CookieJar();
    await signInAs(advisorJar, ADVISOR_EMAIL, ADVISOR_PASSWORD);
    const adminJar = new CookieJar();
    await signInAs(adminJar, ADMIN_EMAIL, ADMIN_PASSWORD);

    for (const route of ["support-hours", "transcript-retention", "login-retention", "embed-allowlist", "analytics"]) {
      const refused = await settingsRequest(advisorJar, route);
      expect(refused.status, `${route} GET as advisor`).toBe(403);
      expect((await settingsRequest(adminJar, route)).status, `${route} GET as admin`).toBe(200);
    }
  });

  it("refuses advisors on all three branding APIs and serves admins", async () => {
    const advisorJar = new CookieJar();
    await signInAs(advisorJar, ADVISOR_EMAIL, ADVISOR_PASSWORD);
    const adminJar = new CookieJar();
    await signInAs(adminJar, ADMIN_EMAIL, ADMIN_PASSWORD);

    // Each route's valid reset, so the role gate alone decides the status.
    const resets: [string, unknown][] = [
      ["branding/chatbot-icon", { image: null }],
      ["branding/dashboard-favicon", { image: null }],
      ["branding/chathead", null],
    ];
    for (const [route, body] of resets) {
      const refused = await settingsRequest(advisorJar, route, "PUT", body);
      expect(refused.status, `${route} PUT as advisor`).toBe(403);
      expect((await settingsRequest(adminJar, route, "PUT", body)).status, `${route} PUT as admin`).toBe(200);
    }
  });
});
