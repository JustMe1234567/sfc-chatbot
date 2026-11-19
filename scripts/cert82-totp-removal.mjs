// Ticket 82 certification: the login page is a single username+password
// stage that lands on the dashboard directly, the enrollment page and the
// two-factor auth routes are gone, and the staff roster carries no
// second-factor display.
//
// RUNS ARE GATED BY TICKET 80: the owner-UI substrate decision, exactly as
// ticket 81's cert anticipates — the script needs a server (dev or the
// substrate ticket 80 settles on) with owner credentials it is given.
//
// Usage: node scripts/cert82-totp-removal.mjs <outdir> [base]
// Env:   CERT_OWNER_USERNAME, CERT_OWNER_PASSWORD
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { signIn, waitForServer } from "./lib/shot-driver.mjs";

const OUT = process.argv[2] ?? ".scratch/college-website-chat/references/ticket82";
const BASE = process.argv[3] ?? "http://127.0.0.1:3000";
const USERNAME = process.env.CERT_OWNER_USERNAME;
const PASSWORD = process.env.CERT_OWNER_PASSWORD;
if (!USERNAME || !PASSWORD) {
  throw new Error("CERT_OWNER_USERNAME and CERT_OWNER_PASSWORD are required");
}

await waitForServer(BASE);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();

async function shot(name) {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  console.log(`shot: ${name}`);
}

// The login page renders one stage: username and password, no authenticator
// code field anywhere in the document.
await page.goto(`${BASE}/dashboard/login`);
await page.waitForLoadState("domcontentloaded");
if (await page.locator("#totp").count()) {
  throw new Error("the login page still renders an authenticator code field");
}
await shot("login-single-stage");

// Password alone reaches the dashboard: no enrollment interstitial.
await signIn(page, BASE, USERNAME, PASSWORD);

// The enrollment route and the two-factor auth routes answer not_found.
for (const path of ["/dashboard/enroll", "/api/auth/two-factor/enable"]) {
  const response = await page.evaluate(async (target) => {
    const result = await fetch(target, { method: "POST" });
    return result.status;
  }, `${BASE}${path}`);
  if (response !== 404) {
    throw new Error(`${path} answered ${response}, expected 404`);
  }
}
console.log("enroll page and two-factor routes are gone (404)");

// The staff roster shows no second-factor state on any member card.
await page.goto(`${BASE}/dashboard/staff`);
await page.waitForLoadState("domcontentloaded");
// The roster page's stable anchor (first run against a real build, 2026-11-20:
// the page carries no bare "Staff" heading — account-form's heading is the
// always-present landmark).
await page.getByRole("heading", { name: "Create a staff account" }).waitFor({ timeout: 30000 });
const factorText = await page.getByText("Second factor", { exact: false }).count();
if (factorText) {
  throw new Error(`the staff roster still mentions the second factor on ${factorText} element(s)`);
}
await shot("staff-page-without-factor-column");

await browser.close();
console.log("ticket 82 cert complete");
