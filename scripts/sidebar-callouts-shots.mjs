// Ticket 57 verification (headless Chromium): the compact icon sidebar with
// one-at-a-time hover callouts. Signs the owner in through the real UI, then
// asserts the rail defaults to compact (no stored preference), that hovering
// or focusing a row shows exactly one callout with that row's label (moving
// replaces it, leaving dismisses it, expanding hides it for good), keyboard
// focus parity, the active row staying highlighted, Sign out's own callout,
// persistence across reload, the drawer keeping visible labels, and no
// overflow at 1280/760/390/360. Ticket 60 adds geometry checks: collapsed
// rows are centered 44px squares with centered marks, the expand/collapse
// control leads the icon stack (expanded and collapsed) with its own
// callout, and the stack reads tight. In before mode it only signs in and
// captures the rail's expanded and collapsed states as the build ships
// them (era-agnostic: pre-57 defaults expanded, 57+ defaults compact).
// Usage: node scripts/sidebar-callouts-shots.mjs <outdir> [port] [before]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import process from "node:process";
import { signIn } from "./lib/shot-driver.mjs";

const OUT = process.argv[2] ?? ".scratch/college-website-chat/references/shots-sidebar-57";
const PORT = process.argv[3] ?? "3216";
const BEFORE = process.argv[4] === "before";
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = process.env.CHATBOT_DB ?? ".scratch/college-website-chat/sidebar57.db";
const USERNAME = "owner";
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

// Light slate: chrome assertions never touch data, so only the rule reset
// runs here. No enrollment wipe (ticket 80): staff credentials live in
// hosted Supabase Auth, not a store table, so the sign-in below requires
// a freshly bootstrapped owner.
const db = new DatabaseSync(DB_PATH);
db.prepare("DELETE FROM answer_rules").run();
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

// --- Sign the owner in through the real UI (password-only since 82). ------
await signIn(page, BASE, USERNAME, PASSWORD);
mkdirSync(OUT, { recursive: true });

const rail = page.locator("aside").first();
const navLinks = rail.getByRole("navigation", { name: "Dashboard" }).getByRole("link");

async function gotoAndWait() {
  await page.goto(`${BASE}/dashboard/inbox`);
  await page.waitForLoadState("domcontentloaded");
  await rail.waitFor({ timeout: 10000 });
}

async function shotAt(width, height, name) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(350);
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.scrollingElement.scrollWidth,
    clientWidth: document.scrollingElement.clientWidth,
  }));
  if (overflow.scrollWidth > overflow.clientWidth + 1) {
    throw new Error(`horizontal overflow at ${width}px on ${name}`);
  }
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  console.log("captured", name);
}

// One callout helper: the open callout element, if any.
function openCallout() {
  return page.locator('[class*="sideTip"][data-open]');
}

async function calloutText() {
  return (await openCallout().innerText()).trim();
}

async function assertCalloutWithinViewport(name) {
  const box = await openCallout().boundingBox();
  if (!box) throw new Error(`${name}: callout has no box`);
  const viewport = page.viewportSize();
  if (
    box.x < 0 ||
    box.y < 0 ||
    box.x + box.width > viewport.width ||
    box.y + box.height > viewport.height
  ) {
    throw new Error(`${name}: callout escapes the viewport at ${JSON.stringify(box)}`);
  }
  if (box.x < 60) {
    throw new Error(`${name}: callout is not anchored beside the rail (x=${box.x})`);
  }
}

if (BEFORE) {
  await gotoAndWait();
  await page.evaluate(() => window.localStorage.removeItem("dashboard.sidebar.collapsed"));
  await gotoAndWait();
  // Era-agnostic: builds before ticket 57 default expanded, 57+ default
  // compact — normalize to expanded so both states get shot either way.
  const expand = rail.getByRole("button", { name: "Expand navigation" });
  if (await expand.count()) {
    await expand.click();
    await page.waitForTimeout(400);
  }
  await shotAt(1280, 900, "before-sidebar-1280");
  // Collapse and hover a row to capture the current tooltip treatment.
  await rail.getByRole("button", { name: "Collapse navigation" }).click();
  await page.waitForTimeout(400);
  await shotAt(1280, 900, "before-sidebar-collapsed-1280");
  await navLinks.first().hover();
  await page.waitForTimeout(300);
  await shotAt(1280, 900, "before-sidebar-hover-1280");
  if (pageErrors.length > 0) throw new Error(`page errors: ${pageErrors.join(" | ")}`);
  await browser.close();
  console.log("before shots captured in", OUT);
  process.exit(0);
}

// --- Compact by default on desktop. -----------------------------------------
await page.evaluate(() => window.localStorage.removeItem("dashboard.sidebar.collapsed"));
await gotoAndWait();
if ((await rail.getAttribute("data-collapsed")) === null) {
  throw new Error("the rail does not default to compact without a saved preference");
}
const railWidth = (await rail.boundingBox()).width;
if (railWidth > 100) {
  throw new Error(`the default rail is not the compact icon rail (width ${railWidth})`);
}
console.log("ok: compact icon rail is the desktop default");

// --- Ticket 60: square centered tiles, the control first, tight rhythm. -----
// Geometry helpers: read computed boxes straight from the laid-out rail.
function boxCenter(box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const toggle = rail.getByRole("button", { name: "Expand navigation" });
if ((await toggle.count()) !== 1) {
  throw new Error("the collapsed rail does not show the expand control");
}
const toggleBox = await toggle.boundingBox();
const firstBox = await navLinks.first().boundingBox();
const railBox = await rail.boundingBox();
// The control leads: above the first nav row, below the crest divider.
if (toggleBox.y + toggleBox.height > firstBox.y) {
  throw new Error("the collapse control is not the first row of the icon stack");
}
// Every nav row is a true 44px square, centered in the rail, mark centered
// in the tile.
for (const [index, link] of (await navLinks.all()).entries()) {
  const tile = await link.boundingBox();
  if (Math.abs(tile.width - 44) > 1 || Math.abs(tile.height - 44) > 1) {
    throw new Error(`row ${index} is not a 44px square: ${JSON.stringify(tile)}`);
  }
  const tileCenter = boxCenter(tile);
  const railCenter = boxCenter(railBox).x;
  if (Math.abs(tileCenter.x - railCenter) > 1.5) {
    throw new Error(`row ${index} is not centered in the rail (${tileCenter.x} vs ${railCenter})`);
  }
  const icon = await link.locator("svg").first().boundingBox();
  const iconCenter = boxCenter(icon);
  if (Math.abs(iconCenter.x - tileCenter.x) > 1.5 || Math.abs(iconCenter.y - tileCenter.y) > 1.5) {
    throw new Error(`row ${index}'s mark sits off-center (${iconCenter.x - tileCenter.x}, ${iconCenter.y - tileCenter.y})`);
  }
}
console.log("ok: every collapsed row is a centered 44px square with a centered mark");
// The control shares the square treatment.
if (Math.abs(toggleBox.width - 44) > 1 || Math.abs(toggleBox.height - 44) > 1) {
  throw new Error(`the collapsed control is not square: ${JSON.stringify(toggleBox)}`);
}
// Tight rhythm: consecutive tiles sit ~2px apart.
for (let i = 0; i < (await navLinks.count()) - 1; i++) {
  const a = await navLinks.nth(i).boundingBox();
  const b = await navLinks.nth(i + 1).boundingBox();
  const gap = b.y - (a.y + a.height);
  if (Math.abs(gap - 2) > 1) {
    throw new Error(`nav rows ${i}/${i + 1} sit ${gap}px apart, expected ~2px`);
  }
}
console.log("ok: the icon stack reads tight (~2px between tiles)");
// The relocated control joins the callout system like the other icon rows.
await toggle.hover();
await openCallout().waitFor({ timeout: 5000 });
if ((await calloutText()) !== "Expand navigation") {
  throw new Error(`the control's callout is missing or mislabelled: "${await calloutText()}"`);
}
await assertCalloutWithinViewport("toggle callout");
await page.getByRole("heading").first().hover();
await page.waitForTimeout(250);
console.log("ok: the leading control shows its own callout on hover");

// --- Hover one row: exactly one callout, with that row's label. -------------
await navLinks.first().hover();
await openCallout().waitFor({ timeout: 5000 });
if ((await openCallout().count()) !== 1) {
  throw new Error("more than one callout is visible");
}
const firstName = await navLinks.first().getAttribute("aria-label");
if ((await calloutText()) !== firstName) {
  throw new Error(`the callout does not name the hovered row: "${await calloutText()}"`);
}
await assertCalloutWithinViewport("hover first row");
console.log("ok: hovering the first row shows exactly its own callout");

// --- Moving to another row replaces the callout; the old one is gone. -------
await navLinks.nth(3).hover();
await page.waitForTimeout(250);
const replaced = await calloutText();
if (replaced === firstName) {
  throw new Error("moving rows did not replace the callout");
}
if ((await openCallout().count()) !== 1) {
  throw new Error("moving rows left more than one callout");
}
// The active row keeps its highlight while another row is hovered.
const currentLink = rail.locator('[aria-current="page"]');
if ((await currentLink.count()) !== 1) {
  throw new Error("the active row lost its aria-current during hover");
}
console.log("ok: moving replaces the callout; the active row stays highlighted");

// --- Leaving dismisses it. ---------------------------------------------------
await page.getByRole("heading").first().hover();
await page.waitForTimeout(250);
if ((await openCallout().count()) !== 0) {
  throw new Error("the callout did not dismiss on leave");
}
console.log("ok: leaving the rail dismisses the callout");

// --- Keyboard focus shows the same individual callout. -----------------------
await navLinks.nth(1).focus();
await openCallout().waitFor({ timeout: 5000 });
const focusedName = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
if ((await calloutText()) !== focusedName) {
  throw new Error(`focus callout does not name the focused row: ${focusedName}`);
}
await assertCalloutWithinViewport("keyboard focus");
await page.keyboard.press("Tab");
await page.waitForTimeout(200);
console.log("ok: keyboard focus shows the same individual callout");

// --- Sign out carries the same callout, visible at the rail's bottom. -------
await rail.getByRole("button", { name: "Sign out" }).hover();
await openCallout().waitFor({ timeout: 5000 });
if ((await calloutText()) !== "Sign out") {
  throw new Error("Sign out's callout is missing or mislabelled");
}
await assertCalloutWithinViewport("sign out");
console.log("ok: Sign out shows its own callout at the rail's bottom");

// --- The expanded rail shows labels and never callouts. ---------------------
await rail.getByRole("button", { name: "Expand navigation" }).click();
await page.waitForTimeout(400);
if ((await rail.getAttribute("data-collapsed")) !== null) {
  throw new Error("the expand control did not expand the rail");
}
await navLinks.first().hover();
await page.waitForTimeout(250);
if ((await openCallout().count()) !== 0) {
  throw new Error("the expanded rail must not show callouts");
}
if (!(await navLinks.first().innerText()).includes("Conversations")) {
  throw new Error("the expanded rail does not show visible labels");
}
console.log("ok: expanded rail shows labels, no callouts");

// --- Ticket 60: the control keeps its leading slot when expanded too. -------
const expandedToggle = rail.getByRole("button", { name: "Collapse navigation" });
const expandedToggleBox = await expandedToggle.boundingBox();
const expandedFirstBox = await navLinks.first().boundingBox();
if (expandedToggleBox.y + expandedToggleBox.height > expandedFirstBox.y) {
  throw new Error("the expanded rail no longer leads with the control");
}
await shotAt(1280, 900, "after-sidebar-expanded-1280");
console.log("ok: the expanded rail also leads with the control");

// --- The choice persists across reload. --------------------------------------
await gotoAndWait();
if ((await rail.getAttribute("data-collapsed")) !== null) {
  throw new Error("the expanded choice did not persist across reload");
}
await rail.getByRole("button", { name: "Collapse navigation" }).click();
await page.waitForTimeout(400);
await gotoAndWait();
if ((await rail.getAttribute("data-collapsed")) === null) {
  throw new Error("the collapsed choice did not persist across reload");
}
console.log("ok: the rail choice persists across reload");

// --- Responsive pass. --------------------------------------------------------
await shotAt(1280, 900, "after-sidebar-compact-1280");
await navLinks.first().hover();
await page.waitForTimeout(250);
await page.screenshot({ path: join(OUT, "after-sidebar-callout-1280.png"), fullPage: true });
console.log("captured after-sidebar-callout-1280");
await rail.getByRole("button", { name: "Sign out" }).hover();
await page.waitForTimeout(250);
await page.screenshot({ path: join(OUT, "after-sidebar-callout-signout-1280.png"), fullPage: true });
console.log("captured after-sidebar-callout-signout-1280");

await shotAt(760, 900, "after-sidebar-760");
// Narrow widths use the drawer with visible labels.
for (const width of [390, 360]) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto(`${BASE}/dashboard/inbox`);
  await page.waitForLoadState("domcontentloaded");
  const menu = page.getByRole("button", { name: "Menu" });
  await menu.click();
  const drawer = page.locator('[aria-label="Dashboard menu"]');
  await drawer.waitFor({ timeout: 5000 });
  if ((await drawer.getByRole("link", { name: "Conversations" }).count()) !== 1) {
    throw new Error(`drawer at ${width}px lacks labelled navigation`);
  }
  await page.keyboard.press("Escape");
  await drawer.waitFor({ state: "hidden", timeout: 5000 });
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.scrollingElement.scrollWidth,
    clientWidth: document.scrollingElement.clientWidth,
  }));
  if (overflow.scrollWidth > overflow.clientWidth + 1) {
    throw new Error(`horizontal overflow at ${width}px`);
  }
  console.log(`ok: drawer labelled + Escape closes at ${width}px`);
}
await page.setViewportSize({ width: 1280, height: 900 });
await shotAt(390, 800, "after-sidebar-drawer-390");

if (pageErrors.length > 0) {
  throw new Error(`page errors during the run: ${pageErrors.join(" | ")}`);
}
await browser.close();
console.log("ticket 57 checks passed; screenshots in", OUT);
