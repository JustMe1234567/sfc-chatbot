// Design-ticket screenshot driver (ticket 13): enrolls and signs the owner in
// through the real UI in headless Chromium, then captures the staff surfaces
// at three viewport widths. Usage: node scripts/design-shots.mjs <outdir> [port]
import { chromium } from "playwright";
import { TOTP, URI } from "otpauth";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const OUT = process.argv[2] ?? ".scratch/college-website-chat/references/shots";
const BASE = `http://127.0.0.1:${process.argv[3] ?? "3122"}`;
const EMAIL = process.env.SHOT_EMAIL ?? "owner@example.edu";
const PASSWORD = process.env.SHOT_PASSWORD ?? "owner-design-check-83";
const WIDTHS = [
  [1280, 800, "desktop"],
  [730, 820, "narrow"],
  [390, 760, "phone"],
];

for (let attempt = 0; ; attempt++) {
  try {
    await fetch(`${BASE}/api/healthz`);
    break;
  } catch {
    if (attempt > 40) throw new Error("server never came up");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// The enrollment flow needs a clean slate: wipe any prior TOTP enrollment
// for the screenshot owner (the script enrolls fresh each run).
const db = new DatabaseSync("chatbot.db");
const owner = db.prepare('SELECT id FROM "user" WHERE email = ?').get(EMAIL);
if (owner) {
  db.prepare('DELETE FROM twoFactor WHERE userId = ?').run(owner.id);
  db.prepare('UPDATE "user" SET "twoFactorEnabled" = 0 WHERE id = ?').run(owner.id);
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
await page.setViewportSize({ width: 1280, height: 800 });

// Enroll TOTP through the UI. A password-only session reaches /dashboard/
// enroll directly (the login page's code stage presumes an existing token).
await page.goto(`${BASE}/dashboard/login`);
await page.waitForLoadState("domcontentloaded");
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await page.click("button[type=submit]");
await page.waitForTimeout(1500);
await page.goto(`${BASE}/dashboard/enroll`);
await page.waitForLoadState("domcontentloaded");
await page.fill("#password", PASSWORD);
await page.click("button[type=submit]");
await page.waitForSelector("code", { timeout: 15000 });
const secret = (await page.textContent("code")).trim();
// URI.parse is the code path the test suite proves correct; a bare
// Secret({b32}) decodes better-auth's ASCII-string secrets differently.
const totp = URI.parse(`otpauth://totp/x?secret=${secret}`);
await page.fill("#totp", totp.generate());
await page.click("button[type=submit]");
// Enrollment signs out; sign back in with the full password + code flow.
await page.waitForURL("**/dashboard/login", { timeout: 15000 });
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await page.click("button[type=submit]");
await page.waitForSelector("#totp", { timeout: 15000 });
await page.fill("#totp", totp.generate());
await page.click("button[type=submit]");
await page.waitForURL("**/dashboard/inbox", { timeout: 15000 });
console.log("signed in; enrollment complete");

mkdirSync(OUT, { recursive: true });
async function shot(path, name) {
  await page.goto(`${BASE}${path}`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  console.log("captured", name);
}

for (const [width, height, label] of WIDTHS) {
  await page.setViewportSize({ width, height });
  await shot("/dashboard/inbox", `after-inbox-${label}`);
  const deskUrl = `${BASE}/dashboard/inbox`;
  // The first conversation entry, if any, opens the populated state. Match by
  // the entry href shape (a uuid after /inbox/), not the section tabs.
  await page.goto(deskUrl);
  await page.waitForLoadState("domcontentloaded");
  const firstEntry = page.locator('a[href*="/dashboard/inbox/"]').first();
  if ((await firstEntry.count()) > 0) {
    await firstEntry.click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, `after-conversation-${label}.png`), fullPage: true });
    console.log("captured", `after-conversation-${label}`);
  }
  await shot("/dashboard/answers", `after-answers-${label}`);
  await shot("/dashboard/notifications", `after-alerts-${label}`);
  await shot("/dashboard/staff", `after-staff-${label}`);
}
// The signed-out screens, in a clean context.
const anon = await browser.newContext();
for (const [width, height, label] of WIDTHS) {
  const anonPage = await anon.newPage();
  await anonPage.setViewportSize({ width, height });
  await anonPage.goto(`${BASE}/dashboard/login`);
  await anonPage.waitForLoadState("domcontentloaded");
  await anonPage.waitForTimeout(400);
  await anonPage.screenshot({ path: join(OUT, `after-login-${label}.png`), fullPage: true });
  console.log("captured", `after-login-${label}`);
  await anonPage.close();
}
await browser.close();
console.log("DONE", OUT);
