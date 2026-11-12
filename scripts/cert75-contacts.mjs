// Ticket 75 certification (headless Chromium, one-off): the Visitor contacts
// links lose the browser's default underline. On a production build against
// a scratch Postgres database, seeds one saved contact over the real API,
// signs the bootstrapped owner in, and measures computed text-decoration on
// the five sort controls and the row link — in their default state, with an
// active sort, under hover, under keyboard-visible focus (whose gold ring
// must still show), on the desktop table and the 390px stacked card.
// Usage: node scripts/cert75-contacts.mjs <outdir> [port]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { TOTP, URI } from "otpauth";
import process from "node:process";

const OUT =
  process.argv[2] ?? ".scratch/college-website-chat/references/ticket75";
const BASE = `http://127.0.0.1:${process.argv[3] ?? "3239"}`;
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

// One saved contact over the real flow: gate → question → the visitor's
// chosen medium. Enough to render a sortable row and a phone card. The name
// is unique per run so a reused scratch db never collides on the text waits.
const VISITOR = `Cert Visitor ${Date.now().toString(36)}`;
const created = await fetch(`${BASE}/api/v1/conversations`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    fullName: VISITOR,
    email: "cert75.visitor1@example.edu",
    phone: "555 010 1000",
  }),
});
if (!created.ok) throw new Error(`conversation create failed: ${created.status}`);
const conversation = await created.json();
async function ask(body) {
  const response = await fetch(
    `${BASE}/api/v1/conversations/${conversation.id}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${conversation.token}`,
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw new Error(`message failed: ${response.status}`);
  return response.json();
}
await ask({ text: "please let me talk to a person" });
await ask({ choice: "handoff-yes" });
console.log("seeded one saved contact over the real flow");

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => {
  pageErrors.push(String(error).slice(0, 300));
  console.log("PAGE ERROR:", String(error).slice(0, 300));
});
await page.setViewportSize({ width: 1280, height: 800 });
mkdirSync(OUT, { recursive: true });

async function shot(name) {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
  console.log("captured", name);
}

/** The anchor's computed text-decoration line, by locator. */
const decorationOf = (locator) =>
  locator.evaluate((el) => getComputedStyle(el).textDecorationLine);

function expectNone(value, label) {
  if (value !== "none") {
    throw new Error(`${label} renders text-decoration: ${value}, expected none`);
  }
}

// ===========================================================================
// Owner sign-in with fresh TOTP enrollment (scratch db).
// ===========================================================================
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
const totp = URI.parse(`otpauth://totp/x?secret=${(await page.textContent("code")).trim()}`);
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

// ===========================================================================
// The underline removal, state by state.
// ===========================================================================
await page.goto(`${BASE}/dashboard/contacts`);
await page.waitForLoadState("domcontentloaded");
await page.locator("#contacts-title").waitFor({ timeout: 10000 });
const table = page.locator("table");
await table.waitFor({ timeout: 10000 });
await table.getByText(VISITOR).waitFor({ timeout: 10000 });

// Default state: all five sort headers and the row's name link.
const sortLinks = page.locator("th a");
if ((await sortLinks.count()) !== 5) {
  throw new Error(`expected five sort links, found ${await sortLinks.count()}`);
}
for (let index = 0; index < 5; index++) {
  expectNone(await decorationOf(sortLinks.nth(index)), `sort header ${index}`);
}
const rowLink = page.locator("tbody a").first();
expectNone(await decorationOf(rowLink), "row name link (desktop)");
await shot("75-contacts-desktop");
console.log("ok: default state — five sort headers and the name link show no underline");

// Active sort: the clicked column's control stays underline-free too.
await page.getByRole("link", { name: /Name/ }).click();
await page.waitForURL(/sort=name&dir=asc/, { timeout: 10000 });
expectNone(await decorationOf(page.getByRole("link", { name: /Name/ })), "active sort header");
console.log("ok: the active sort control shows no underline");

// Hover: neither the sort headers nor the row link underline on hover.
const lastSort = sortLinks.nth(4);
await lastSort.hover();
expectNone(await decorationOf(lastSort), "hovered sort header");
await rowLink.hover();
expectNone(await decorationOf(rowLink), "hovered row name link");
console.log("ok: hover state — no underline on sort headers or the name link");

// Keyboard-visible focus: the gold focus ring still shows (the affordance
// that replaces the underline) and the underline stays gone.
await rowLink.evaluate((el) => el.focus({ focusVisible: true }));
const rowFocused = await rowLink.evaluate((el) => ({
  visible: el.matches(":focus-visible"),
  decoration: getComputedStyle(el).textDecorationLine,
}));
if (!rowFocused.visible) throw new Error("the row link did not show keyboard focus");
expectNone(rowFocused.decoration, "keyboard-focused row link");

const emailSort = sortLinks.nth(1);
await emailSort.evaluate((el) => el.focus({ focusVisible: true }));
const sortFocused = await emailSort.evaluate((el) => ({
    visible: el.matches(":focus-visible"),
    decoration: getComputedStyle(el).textDecorationLine,
    outline: getComputedStyle(el).outlineStyle,
  }));
if (!sortFocused.visible) throw new Error("the sort control did not show keyboard focus");
if (sortFocused.outline === "none") {
  throw new Error("the sort control lost its focus-visible ring");
}
expectNone(sortFocused.decoration, "keyboard-focused sort header");
console.log("ok: keyboard focus — the gold ring shows and no underline returns");

// Phones: the stacked card's name link (same classes) has no underline.
await page.setViewportSize({ width: 390, height: 800 });
await page.waitForTimeout(300);
const cardLink = page.locator('td[data-label="Name"] a').first();
expectNone(await decorationOf(cardLink), "row name link (390px card)");
const overflow390 = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
if (overflow390 > 1) {
  throw new Error(`390px overflows horizontally by ${overflow390}px`);
}
await shot("75-contacts-390");
console.log("ok: 390px — the stacked card's name link shows no underline, no overflow");

if (pageErrors.length > 0) {
  throw new Error(`page errors during the run: ${pageErrors.join(" | ")}`);
}
await browser.close();
console.log("ticket 75 checks passed;");
console.log("screenshots in", OUT);
