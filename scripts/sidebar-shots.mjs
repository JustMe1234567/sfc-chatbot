// Ticket 52 verification (headless Chromium): the collapsible dashboard
// sidebar. Signs the owner in through the real UI, then asserts the rail
// (five role-filtered items, icons, aria-current), the collapse toggle
// (width animation endpoints, hidden labels, tooltips on hover, localStorage
// persistence across reload), the drawer at narrow widths (menu control,
// scrim click, Escape, close-on-navigate), and no overflow at 360/390.
// Usage: node scripts/sidebar-shots.mjs <outdir> [port]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { TOTP, URI } from "otpauth";
import process from "node:process";

const OUT = process.argv[2] ?? ".scratch/college-website-chat/references/shots-sidebar";
const PORT = process.argv[3] ?? "3216";
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = process.env.CHATBOT_DB ?? ".scratch/college-website-chat/history51.db";
const EMAIL = "owner@example.edu";
const PASSWORD = "Springfield2026!";

for (let attempt = 0; ; attempt++) {
  try {
    await fetch(`${BASE}/api/healthz`);
    break;
  } catch {
    if (attempt > 40) throw new Error("server never came up");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// Light slate: wipe only the enrollment (conversations are irrelevant to
// the chrome and the retention default from ticket 47 may sweep them, which
// this script never asserts on).
const db = new DatabaseSync(DB_PATH);
const owner = db.prepare('SELECT id FROM "user" WHERE email = ?').get(EMAIL);
if (owner) {
  db.prepare("DELETE FROM twoFactor WHERE userId = ?").run(owner.id);
  db.prepare('UPDATE "user" SET "twoFactorEnabled" = 0 WHERE id = ?').run(owner.id);
  db.prepare('DELETE FROM "session" WHERE "userId" = ?').run(owner.id);
  console.log("wiped prior enrollment for", EMAIL);
} else {
  console.log("no prior enrollment to wipe");
}
db.close();

const warm = await fetch(`${BASE}/api/v1/topics`);
if (!warm.ok) throw new Error(`topics fetch failed: ${warm.status}`);

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => {
  pageErrors.push(String(error).slice(0, 300));
  console.log("PAGE ERROR:", String(error).slice(0, 300));
});
await page.setViewportSize({ width: 1280, height: 900 });

// --- Sign the owner in through the real UI (fresh TOTP enrollment). ------
await page.goto(`${BASE}/dashboard/login`);
await page.waitForLoadState("domcontentloaded");
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await page.click("button[type=submit]");
await page.waitForTimeout(3000);
await page.goto(`${BASE}/dashboard/enroll`);
await page.waitForLoadState("domcontentloaded");
await page.fill("#password", PASSWORD);
await page.click("button[type=submit]");
await page.waitForSelector("code", { timeout: 15000 });
const secret = (await page.textContent("code")).trim();
const totp = URI.parse(`otpauth://totp/x?secret=${secret}`);
await page.fill("#totp", totp.generate());
await page.click("button[type=submit]");
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
// Start every run from the default: expanded.
await page.evaluate(() => window.localStorage.removeItem("dashboard.sidebar.collapsed"));

const rail = page.locator('aside[data-collapsed], aside:not([data-collapsed])').first();
const railNav = page.locator('nav[aria-label="Dashboard"]').first();

// --- The desktop rail: brand, five items, icons, active state. ------------
await rail.waitFor({ timeout: 10000 });
const labels = await railNav.locator(".sideItem, [class*='sideItem']").allInnerTexts();
const expected = ["Conversations", "Analytics", "Answers", "Staff", "Email alerts"];
const flat = labels.map((text) => text.replace(/\s+/g, " ").trim());
for (const item of expected) {
  if (!flat.some((text) => text.includes(item))) {
    throw new Error(`the rail is missing the "${item}" item`);
  }
}
const iconCount = await railNav.locator("svg").count();
if (iconCount < 5) {
  throw new Error(`expected an SVG icon per area, found ${iconCount}`);
}
const current = await railNav.locator('[aria-current="page"]').innerText();
if (!current.includes("Conversations")) {
  throw new Error(`the wrong item is marked current: ${current}`);
}
// The college name renders uppercased by its style; innerText returns the
// transformed text, so compare case-insensitively.
const brand = (await rail.innerText()).toLowerCase();
if (!brand.includes("springfield college")) {
  throw new Error(`the rail lost the college brand; rail text: ${brand.slice(0, 160)}`);
}
const who = await rail.getByText("College Owner").count();
if (who !== 1) {
  throw new Error("the signed-in identity is not pinned to the rail");
}
const titleText = await page.locator("h1").innerText();
if (!titleText.includes("Conversations")) {
  throw new Error(`the content heading lost the page title: ${titleText}`);
}
const expandedWidth = await rail.evaluate((el) => el.getBoundingClientRect().width);
if (expandedWidth < 200 || expandedWidth > 300) {
  throw new Error(`the expanded rail is not ~250px wide: ${expandedWidth}`);
}
// The content column sits beside the rail, not under it.
const contentX = await page.locator("h1").evaluate((el) => el.getBoundingClientRect().x);
if (contentX < expandedWidth) {
  throw new Error(`the content heading starts under the rail (x=${contentX})`);
}
await page.screenshot({ path: join(OUT, "after-sidebar-expanded-1280.png"), fullPage: false });
console.log("ok: expanded rail renders brand, five iconed items, identity, content title");

// --- Collapse: width shrinks, labels hide, state persists. ----------------
await page.getByRole("button", { name: "Collapse navigation" }).click();
await page.waitForTimeout(350);
const collapsedWidth = await rail.evaluate((el) => el.getBoundingClientRect().width);
if (collapsedWidth < 50 || collapsedWidth > 100) {
  throw new Error(`the collapsed rail is not an icon strip: ${collapsedWidth}px`);
}
const labelVisible = await railNav
  .locator("[class*='sideLabel']")
  .first()
  .evaluate((el) => getComputedStyle(el).visibility !== "hidden" && el.getBoundingClientRect().width > 1);
if (labelVisible) {
  throw new Error("labels must hide in the collapsed rail");
}
const stored = await page.evaluate(() => window.localStorage.getItem("dashboard.sidebar.collapsed"));
if (stored !== "1") {
  throw new Error(`the collapsed choice was not persisted (${stored})`);
}
await page.reload();
await page.waitForLoadState("domcontentloaded");
await rail.waitFor({ timeout: 10000 });
// The rail re-collapses in a mounted effect, so the width animation is
// still running at first paint — let it settle before measuring.
await page.waitForTimeout(450);
const reloadedWidth = await rail.evaluate((el) => el.getBoundingClientRect().width);
if (reloadedWidth > 100) {
  throw new Error(`the collapsed choice did not survive a reload (${reloadedWidth}px)`);
}
console.log("ok: collapse shrinks to an icon rail and persists across reload");

// --- Tooltips appear only from the collapsed rail. -------------------------
const analytics = railNav.locator('[aria-current="page"], [class*="sideItem"]').filter({ hasText: "Analytics" }).first();
await analytics.hover();
await page.waitForTimeout(200);
const tipVisible = await analytics
  .locator("[class*='sideTip']")
  .evaluate((el) => getComputedStyle(el).display !== "none");
if (!tipVisible) {
  throw new Error("hovering a collapsed item must show its tooltip");
}
const tipText = await analytics.locator("[class*='sideTip']").innerText();
if (!tipText.includes("Analytics")) {
  throw new Error(`the tooltip names the wrong item: ${tipText}`);
}
await page.screenshot({ path: join(OUT, "after-sidebar-tooltip-1280.png"), fullPage: false });
await page.mouse.move(640, 400);
await page.waitForTimeout(200);
const tipHidden = await analytics
  .locator("[class*='sideTip']")
  .evaluate((el) => getComputedStyle(el).display === "none");
if (!tipHidden) {
  throw new Error("the tooltip must dismiss on pointer leave");
}
console.log("ok: collapsed tooltips show on hover and dismiss on leave");
await page.screenshot({ path: join(OUT, "after-sidebar-collapsed-1280.png"), fullPage: false });

// --- Keyboard: a focused collapsed item shows its tooltip too. -------------
await page.evaluate(() => window.localStorage.setItem("dashboard.sidebar.collapsed", "1"));
await page.reload();
await page.waitForLoadState("domcontentloaded");
await rail.waitFor({ timeout: 10000 });
await railNav.locator("[class*='sideItem']").first().focus();
await page.waitForTimeout(200);
const focusTip = await railNav
  .locator("[class*='sideItem']")
  .first()
  .locator("[class*='sideTip']")
  .evaluate((el) => getComputedStyle(el).display !== "none");
if (!focusTip) {
  throw new Error("keyboard focus on a collapsed item must show its tooltip");
}
console.log("ok: tooltips answer keyboard focus as well");
// Restore expanded for the drawer pass.
await page.getByRole("button", { name: "Expand navigation" }).click();
await page.waitForTimeout(350);

// --- Narrow screens: drawer replaces the rail. -----------------------------
async function assertNoOverflow(width) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.scrollingElement.scrollWidth,
    clientWidth: document.scrollingElement.clientWidth,
  }));
  if (overflow.scrollWidth > overflow.clientWidth + 1) {
    throw new Error(`horizontal overflow at ${width}px`);
  }
}

await page.setViewportSize({ width: 390, height: 850 });
await page.waitForTimeout(350);
await assertNoOverflow(390);
if ((await rail.evaluate((el) => getComputedStyle(el).display)) !== "none") {
  throw new Error("the rail must leave the layout at narrow widths");
}
const menu = page.getByRole("button", { name: "Menu" });
if ((await menu.count()) !== 1) {
  throw new Error("the content head must carry the drawer control");
}
await menu.click();
const drawer = page.locator("[class*='sideDrawer']");
await drawer.waitFor({ timeout: 5000 });
if ((await drawer.locator("[class*='sideItem']").count()) !== 5) {
  throw new Error("the drawer must carry all five items for the owner");
}
// Focus moved into the drawer.
if ((await page.evaluate(() => document.activeElement?.closest("[class*='sideDrawer']") != null)) !== true) {
  throw new Error("opening the drawer did not move focus into it");
}
await page.screenshot({ path: join(OUT, "after-sidebar-drawer-390.png"), fullPage: false });
// Escape closes; focus returns to the menu control.
await page.keyboard.press("Escape");
await drawer.waitFor({ state: "detached", timeout: 5000 });
const backOnMenu = await page.evaluate(
  () => document.activeElement?.getAttribute("aria-label") === "Menu",
);
if (!backOnMenu) {
  throw new Error("Escape must return focus to the drawer control");
}
console.log("ok: drawer opens with focus, Escape closes back to the control");

// Scrim click closes (at a point beside the drawer, not over it).
await menu.click();
await drawer.waitFor({ timeout: 5000 });
await page.locator("[class*='sideScrim']").click({ position: { x: 360, y: 40 } });
await drawer.waitFor({ state: "detached", timeout: 5000 });

// Navigating closes.
await menu.click();
await drawer.waitFor({ timeout: 5000 });
await drawer.locator('[class*="sideItem"]:has-text("Analytics")').click();
await page.waitForURL("**/dashboard/analytics", { timeout: 10000 });
await drawer.waitFor({ state: "detached", timeout: 5000 });
const analyticsCurrent = await page
  .locator('nav[aria-label="Dashboard"]')
  .first()
  .locator('[aria-current="page"]')
  .innerText();
if (!analyticsCurrent.includes("Analytics")) {
  throw new Error(`navigation did not move aria-current: ${analyticsCurrent}`);
}
console.log("ok: scrim click and navigation both close the drawer; aria-current follows");

// --- 360px sweep. -----------------------------------------------------------
await page.setViewportSize({ width: 360, height: 800 });
await page.waitForTimeout(350);
await assertNoOverflow(360);
await page.screenshot({ path: join(OUT, "after-sidebar-360.png"), fullPage: false });
console.log("captured after-sidebar-360 (no overflow)");

if (pageErrors.length > 0) {
  throw new Error(`page errors during the run: ${pageErrors.join(" | ")}`);
}
await browser.close();
console.log("ticket 52 checks passed; screenshots in", OUT);
