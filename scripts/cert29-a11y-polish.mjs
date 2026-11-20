// Ticket 29 certification (headless Chromium, one-off): the widget and
// dashboard accessibility polish batch. Signs the owner in through the real
// UI (fresh scratch database), Tab-walks the
// dashboard to prove the skip link is the first focusable element and jumps
// to the content, asserts the per-route document titles, then drives the
// widget: the contact email's autocomplete attribute (the audit's box the
// ticket-66 gate already satisfies), keyboard focus scrolling every topic
// chip into view on the scrollbar-less strip (the confirm-only box), and
// the seeded admissions answer's external link carrying its visually
// hidden "opens in a new tab" warning. Usage:
// node scripts/cert29-a11y-polish.mjs <outdir> [port]
// Dev-mode only (ticket 78): under a production build the ticket-76 embed
// allowlist denies the loopback demo origin — the probe below fails fast.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { assertDemoOriginEmbeddable, signIn } from "./lib/shot-driver.mjs";

const OUT =
  process.argv[2] ?? ".scratch/college-website-chat/references/ticket29";
mkdirSync(OUT, { recursive: true });
const BASE = `http://127.0.0.1:${process.argv[3] ?? "3233"}`;
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

// Ticket 78 guard: the widget steps drive the demo page, which must be an
// allowed widget host — this cert is dev-mode-only.
await assertDemoOriginEmbeddable(BASE);

// Any chatbot route initializes the service singleton (migrations + seed
// rules); healthz alone does not — and the enrollment wipe below needs the
// tables.
const topics = await fetch(`${BASE}/api/v1/topics`);
if (!topics.ok) throw new Error(`topics fetch failed: ${topics.status}`);

function assert(condition, message) {
  if (!condition) {
    throw new Error(`cert 29 FAILED: ${message}`);
  }
  console.log(`ok: ${message}`);
}

// No local enrollment wipe (ticket 80): staff credentials live in hosted
// Supabase Auth, not a store table, so this cert simply requires a freshly
// bootstrapped owner for the sign-in below.

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 800 });

async function shot(name) {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
  console.log("captured", name);
}

// ===========================================================================
// Part A — the dashboard: skip link, content jump, per-route titles.
// ===========================================================================

// The unauthenticated route's title through the segment layout.
await page.goto(`${BASE}/dashboard/login`);
await page.waitForLoadState("domcontentloaded");
assert(
  (await page.title()) === "Sign in · Springfield College chat",
  "login page titles itself through the dashboard template",
);

// Owner sign-in (password-only since ticket 82). The first visit
// cold-compiles each route on a dev server, so waits key on URLs and
// generous element timeouts rather than fixed sleeps.
await signIn(page, BASE, USERNAME, PASSWORD);

async function expectTitle(title) {
  const actual = await page.title();
  assert(actual === `${title} · Springfield College chat`, `route title: ${actual}`);
}

// From a fresh page load, one Tab lands on the skip link and Enter jumps
// the rail to the content (tabindex=-1 makes the target take focus).
await page.goto(`${BASE}/dashboard/inbox`);
await page.waitForLoadState("domcontentloaded");
await page.keyboard.press("Tab");
let active = await page.evaluate(() => ({
  text: document.activeElement?.textContent ?? "",
  class: document.activeElement?.className ?? "",
}));
assert(active.text === "Skip to content", "first Tab lands on the skip link");
await shot("29-skip-link-focused");
await page.keyboard.press("Enter");
active = await page.evaluate(() => ({
  id: document.activeElement?.id ?? "",
}));
assert(active.id === "sfc-content", "Enter on the skip link focuses the content area");
await shot("29-content-focused");

// Every dashboard route names itself in the document title.
const routes = [
  ["/dashboard/inbox/history", "History"],
  ["/dashboard/answers", "Answers"],
  ["/dashboard/answers/new", "New rule"],
  ["/dashboard/analytics", "Analytics"],
  ["/dashboard/settings", "Settings"],
  ["/dashboard/staff", "Staff"],
];
for (const [route, title] of routes) {
  await page.goto(`${BASE}${route}`);
  await page.waitForLoadState("domcontentloaded");
  await expectTitle(title);
}

// The answer form's preview carries the same external-link warning.
await page.goto(`${BASE}/dashboard/answers/new`);
await page.waitForLoadState("domcontentloaded");
await page.fill("#rule-topic", "Cert 29");
await page.fill("#rule-response", "Cert 29 preview response.");
await page.fill("#rule-link", "https://www.springfieldcollege.edu/cert29");
const previewLink = page.locator('a[href="https://www.springfieldcollege.edu/cert29"]');
await previewLink.waitFor({ timeout: 10000 });
const warned = await previewLink.evaluate(
  (el) => el.querySelector("span")?.textContent ?? "",
);
assert(
  warned.includes("opens in a new tab"),
  "the rule form's preview link warns about the new tab",
);

// ===========================================================================
// Part B — the widget: autocomplete, topics-strip keyboard reach, link.
// ===========================================================================
await page.goto(`${BASE}/demo/wordpress-test-page.html`);
await page.waitForSelector(".sfcw-launcher");
const frame = page.frameLocator(".sfcw-frame");

await page.getByRole("button", { name: "Chat with Springfield College" }).click();
const emailInput = frame.locator("#sfcw-email");
await emailInput.waitFor({ timeout: 10000 });
assert(
  (await emailInput.getAttribute("autocomplete")) === "email",
  "the contact email input advertises autocomplete=email",
);

await frame.locator("#sfcw-name").fill("Jane Doe");
await emailInput.fill("jane.doe@example.org");
await frame.locator("#sfcw-phone").fill("(555) 555-0100");
await frame.getByRole("button", { name: "Start chat" }).click();
const composer = frame.locator('textarea[placeholder="Type your question"]');
await composer.waitFor({ timeout: 15000 });

// Box 6 (confirm-only): Tab-walk from the composer the way a keyboard user
// travels — past the send button and whatever else precedes the strip — and
// require every focused chip to be fully inside the strip's visible box:
// the scrollIntoView cue must work with the scrollbar hidden.
async function stripState() {
  return frame.locator('[aria-label="Suggested questions"]').evaluate((strip) => {
    const active = document.activeElement;
    if (!strip.contains(active)) return { inside: false };
    const box = strip.getBoundingClientRect();
    const chip = active.getBoundingClientRect();
    return {
      inside: true,
      fullyVisible: chip.left >= box.left - 1 && chip.right <= box.right + 1,
    };
  });
}

const chips = frame.locator('[aria-label="Suggested questions"] button');
const chipCount = await chips.count();
assert(chipCount >= 2, `topic chips present (${chipCount})`);
// A click sets the browser's focused frame — .focus() on a frameLocator child does not.
await composer.click();
let chipsSeen = 0;
let allVisible = true;
// The dev-server Next tools portal inflates the forward Tab distance; a
  // production build walks Send -> close -> chips directly. Budget heads up.
  for (let tab = 0; tab < chipCount + 16 && chipsSeen < chipCount; tab++) {
  await page.keyboard.press("Tab");
  const state = await stripState();
  if (!state.inside) continue;
  chipsSeen += 1;
  if (!state.fullyVisible) {
    allVisible = false;
    console.log(`chip ${chipsSeen - 1} not fully visible on focus`, state);
    break;
  }
}
await shot("29-chip-keyboard-focus");
assert(
  chipsSeen === chipCount && allVisible,
  `keyboard focus scrolls every chip into view on the scrollbar-less strip (${chipsSeen}/${chipCount})`,
);

// Box 1: the admissions answer's external link carries the hidden warning.
await chips.filter({ hasText: "Admissions" }).first().click();
const visitLink = frame.getByRole("link", { name: /Visit the college page/ }).first();
await visitLink.waitFor({ timeout: 15000 });
const warning = await visitLink.evaluate((el) => el.querySelector("span")?.textContent ?? "");
assert(
  warning.includes("opens in a new tab"),
  "the widget's external link warns about the new tab",
);
await shot("29-link-with-warning");

await browser.close();
console.log("cert 29 PASSED");
