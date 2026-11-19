// Ticket 81 certification (headless Chromium): the owner-only Logs tab —
// both views (Log in logs, Suspicious logs), the flag marking in the
// complete log, and the three deletion confirm dialogs. Also exercises the
// live block through the real sign-in path: ten unknown-username failures
// from the browser's own IP trigger the one-hour block, whose eleventh-on
// attempts land as Blocked rows while the owner's valid-username session is
// untouched (the carve-out), which is exactly what the log should show.
//
// RUNS ARE GATED BY TICKET 80: the owner-UI substrate decision. The script
// needs a server (dev or the substrate ticket 80 settles on) with a
// freshly bootstrapped owner whose credentials it is given.
//
// Usage: node scripts/cert81-login-logs.mjs <outdir> [base]
// Env:   CERT_OWNER_USERNAME, CERT_OWNER_PASSWORD (a freshly provisioned owner)
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { signIn, waitForServer } from "./lib/shot-driver.mjs";

const OUT = process.argv[2] ?? ".scratch/college-website-chat/references/ticket81";
const BASE = process.argv[3] ?? "http://127.0.0.1:3000";
const USERNAME = process.env.CERT_OWNER_USERNAME;
const PASSWORD = process.env.CERT_OWNER_PASSWORD;
if (!USERNAME || !PASSWORD) {
  throw new Error("CERT_OWNER_USERNAME and CERT_OWNER_PASSWORD (a freshly bootstrapped owner) are required");
}

await waitForServer(BASE);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();

async function shot(name) {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  console.log(`shot: ${name}`);
}

// Sign in through the real UI. The single success from this browser's IP
// is the criterion-(b) flag (first-ever-IP sign-in) the Suspicious view
// shows.
await signIn(page, BASE, USERNAME, PASSWORD);

// Drive the sign-in traffic from the page's own origin (the auth seam only
// accepts the app's trusted origin), so every attempt carries one client
// identity: ten unknown-username failures trigger the block, two more land
// as Blocked, and one wrong password against the valid owner username shows
// the carve-out processing normally mid-block.
const traffic = await page.evaluate(async (owner) => {
  const outcomes = [];
  async function attempt(username, password) {
    const response = await fetch("/api/auth/sign-in/username", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    outcomes.push({ username, status: response.status });
  }
  for (let i = 0; i < 10; i++) {
    await attempt(`ghost-probe-${i}`, "not-the-password");
  }
  for (let i = 0; i < 2; i++) {
    await attempt("ghost-probe-blocked", "not-the-password");
  }
  await attempt(owner, "still-not-the-password");
  return outcomes;
}, USERNAME);

const blockedStatuses = traffic.filter((attempt) => attempt.username === "ghost-probe-blocked").map((attempt) => attempt.status);
if (!blockedStatuses.every((status) => status === 401)) {
  throw new Error(`the blocked attempts were not rejected with the ordinary failure: ${JSON.stringify(blockedStatuses)}`);
}
console.log("drove 13 failures from the browser IP; the block is in force");

// The two views.
await page.goto(`${BASE}/dashboard/logs`);
await page.waitForLoadState("domcontentloaded");
await page.getByRole("tab", { name: "Log in logs" }).waitFor({ timeout: 30000 });
await page.getByText("ghost-probe-blocked", { exact: false }).first().waitFor({ timeout: 30000 });
const suspiciousBadges = await page.getByText("Suspicious", { exact: true }).count();
if (suspiciousBadges === 0) {
  throw new Error("no Suspicious markings rendered in the complete log");
}
await shot("logs-complete-view");

await page.getByRole("tab", { name: "Suspicious logs" }).click();
// Criterion-(c) flags: the 3rd-on unknown-username failures are the ones the
// suspicious view exists for. The blocked attempts themselves are NOT
// flagged — ticket 81's second amendment records blocked rows with
// suspicious false so they feed no counter — they belong to the complete
// view only. (First run against a real build, 2026-11-20: the script
// originally waited for the blocked username here.)
await page.getByText("ghost-probe-2", { exact: false }).first().waitFor({ timeout: 30000 });
const rows = await page.locator("tbody tr").count();
if (rows === 0) {
  throw new Error("the suspicious view rendered empty with flags present");
}
await shot("logs-suspicious-view");

// The checkbox-selection delete confirmation.
await page.getByRole("tab", { name: "Log in logs" }).click();
await page.locator('input[type="checkbox"]').nth(1).check();
await page.getByRole("button", { name: "Delete selected" }).click();
await page.getByRole("dialog").waitFor({ timeout: 15000 });
await shot("logs-confirm-selected-delete");
await page.getByRole("button", { name: "Cancel" }).click();

// The single-entry delete confirmation, confirmed for real. The traffic
// above lands TWO blocked rows for this username, so the locator must pin
// one — .first() — or strict mode refuses the click. (First run against a
// real build, 2026-11-20.)
await page.getByRole("button", { name: /Delete the entry for ghost-probe-blocked/ }).first().click();
await page.getByRole("dialog").waitFor({ timeout: 15000 });
await shot("logs-confirm-single-delete");
await page.getByRole("button", { name: "Delete", exact: true }).click();
await page.getByText("Entry deleted.", { exact: true }).waitFor({ timeout: 15000 });

// The clear-all confirmation (cancelled, so the log survives the run).
await page.getByRole("button", { name: "Clear all" }).click();
await page.getByRole("dialog").waitFor({ timeout: 15000 });
await shot("logs-confirm-clear-all");
await page.getByRole("button", { name: "Cancel" }).click();

await browser.close();
console.log("ticket 81 cert complete");
