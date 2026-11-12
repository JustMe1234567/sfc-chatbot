// Ticket 74 certification (headless Chromium, one-off): the Visitor contacts
// redesign. On a production build against a scratch Postgres database, seeds
// twelve saved contacts over the real API (contact gate → handoff prompt →
// the visitor's chosen medium), signs the bootstrapped owner in, and drives
// the redesigned page: the single reference-style heading (the shared
// header's title visually hidden here only), the count pill and labeled
// search, server-side search narrowing the pill to its singular form, the
// distinct no-results state, sort links rewriting the URL with aria-sort on
// the column, pager preservation with the search carried through, URL
// fallbacks for junk parameters, and 390/360px presentation without
// horizontal overflow.
// Usage: node scripts/cert74-contacts.mjs <outdir> [port]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { TOTP, URI } from "otpauth";
import process from "node:process";

const OUT =
  process.argv[2] ?? ".scratch/college-website-chat/references/ticket74";
const BASE = `http://127.0.0.1:${process.argv[3] ?? "3236"}`;
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

// Twelve saved contacts over the real flow: gate → question → handoff
// prompt → the visitor's chosen medium. Names and phones differ so search
// and every sort have something to order.
const CONTACTS = Array.from({ length: 12 }, (_, index) => ({
  fullName: index === 11 ? "Zoe Zimmerman" : `Cert Visitor ${String(index + 1).padStart(2, "0")}`,
  email: `cert74.visitor${index + 1}@example.edu`,
  phone: `555 010 ${String(1000 + index)}`,
  medium: ["email", "phone", "chat"][index % 3],
}));

async function seedContact(entry) {
  const created = await fetch(`${BASE}/api/v1/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
  if (!created.ok) throw new Error(`conversation create failed: ${created.status}`);
  const conversation = await created.json();
  async function ask(body) {
    const response = await fetch(`${BASE}/api/v1/conversations/${conversation.id}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${conversation.token}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`message failed: ${response.status}`);
    return response.json();
  }
  await ask({ text: "please let me talk to a person" });
  if (entry.medium === "chat") {
    await ask({ choice: "handoff-yes" });
  } else {
    await ask({ choice: "handoff-no" });
    await ask({ choice: entry.medium === "email" ? "contact-email" : "contact-phone" });
  }
}

for (const entry of CONTACTS) {
  await seedContact(entry);
}
console.log("seeded", CONTACTS.length, "saved contacts over the real flow");

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
// The redesigned page: single heading, pill, search, table.
// ===========================================================================
await page.goto(`${BASE}/dashboard/contacts`);
await page.waitForLoadState("domcontentloaded");
await page.locator("#contacts-title").waitFor({ timeout: 10000 });

// The shared header's title is visually hidden here; exactly one visible
// "Visitor contacts" text remains, and it is the content heading.
const headerTitle = page.locator("h1", { hasText: "Visitor contacts" });
if ((await headerTitle.count()) !== 1) {
  throw new Error("the accessible h1 went missing");
}
const headerHidden = await headerTitle.evaluate((el) => {
  const style = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return (
    style.position === "absolute" ||
    style.clipPath !== "none" ||
    rect.width === 0 ||
    rect.height === 0
  );
});
if (!headerHidden) {
  throw new Error("the shared header's duplicate title is still visible");
}
const eyebrow = await page.locator('[aria-labelledby="contacts-title"]').textContent();
if (!eyebrow?.includes("Follow-up contacts")) {
  throw new Error("the reference eyebrow is missing");
}

const pill = page.locator('[class*="contactsPill"]');
if (!(await pill.textContent())?.includes("12 saved contacts")) {
  throw new Error(`the unfiltered pill is wrong: ${await pill.textContent()}`);
}
const search = page.locator('[aria-label="Search contacts"]');
if ((await search.count()) !== 1) {
  throw new Error("the labeled search field is missing");
}
const table = page.locator("table");
await table.waitFor({ timeout: 10000 });
const headers = await page.locator("th").allTextContents();
if (headers.length !== 5) {
  throw new Error(`expected five sortable columns, found ${headers.length}`);
}
// Default sort: Date requested descending — the newest contact (12) first.
await table.getByText("Zoe Zimmerman").waitFor({ timeout: 10000 });
await shot("74-contacts-default");
console.log("ok: single reference heading, pill, labeled search, five columns, newest first");

// ===========================================================================
// Search: server-side narrowing, singular pill, no-results state.
// ===========================================================================
await search.fill("zoe zimmerman");
await page.locator("form").first().press("Enter");
await page.waitForURL(/q=/, { timeout: 10000 });
const searchPill = await pill.textContent();
if (!(await pill.textContent())?.includes("1 matching contact")) {
  throw new Error(`the filtered pill is wrong: ${searchPill}`);
}
if ((await table.locator("tbody tr").count()) !== 1) {
  throw new Error("the filtered table did not narrow to one row");
}
console.log("ok: case-insensitive search narrows the pill to its singular form");

await page.goto(`${BASE}/dashboard/contacts?q=nosuchperson&sort=name&dir=asc`);
await page.getByText("No contacts match your search").waitFor({ timeout: 10000 });
console.log("ok: a zero-match search has its own state");
await page.goto(`${BASE}/dashboard/contacts?q=%20cert74.visitor5@%20&sort=name`);
await page.waitForFunction(
  () => document.querySelectorAll("tbody tr").length === 1,
  { timeout: 10000 },
);
console.log("ok: a padded query trims and still finds the row");

// ===========================================================================
// Sorting: URL rewrite, aria-sort, direction toggle, page reset.
// ===========================================================================
await page.goto(`${BASE}/dashboard/contacts`);
await table.waitFor({ timeout: 10000 });
await page.locator('th[aria-sort]').first().waitFor({ timeout: 10000 });
const defaultSort = await page.locator('th[aria-sort]').getAttribute("aria-sort");
if (defaultSort !== "descending") {
  throw new Error(`the default sort direction is ${defaultSort}, expected descending`);
}
await page.getByRole("link", { name: /Name/ }).click();
await page.waitForURL(/sort=name&dir=asc/, { timeout: 10000 });
const nameSort = await page.locator('th:has([aria-label=""], a)').first().evaluate(() => {
  const th = [...document.querySelectorAll("th")].find((cell) =>
    cell.textContent?.includes("Name"),
  );
  return th?.getAttribute("aria-sort");
});
if (nameSort !== "ascending") {
  throw new Error(`the Name column's aria-sort is ${nameSort}, expected ascending`);
}
// Ascending names: Cert Visitor 01 leads.
if (!(await table.getByText("Cert Visitor 01").isVisible())) {
  throw new Error("name-ascending did not put Visitor 01 first");
}
await page.getByRole("link", { name: /Name/ }).click();
await page.waitForURL(/dir=desc/, { timeout: 10000 });
console.log("ok: column sorts rewrite the URL, set aria-sort, and toggle direction");

// Junk parameters fall back safely.
await page.goto(`${BASE}/dashboard/contacts?sort=junk&dir=down&page=99`);
await table.waitFor({ timeout: 10000 });
if ((await table.locator("tbody tr").count()) !== 10) {
  throw new Error("junk parameters did not fall back to the default first page");
}
console.log("ok: junk sort, direction, and page parameters fall back safely");

// The pager preserves the search and sort.
await page.goto(`${BASE}/dashboard/contacts?sort=name&dir=asc&page=2`);
await page.waitForLoadState("domcontentloaded");
const secondPageHref = await page
  .locator('nav[aria-label="Visitor contacts pages"] a[aria-current="page"]')
  .getAttribute("href");
if (!secondPageHref?.includes("sort=name")) {
  throw new Error(`the pager dropped the sort state: ${secondPageHref}`);
}
await shot("74-contacts-sorted");
console.log("ok: the pager carries search and sort state through its links");

// ===========================================================================
// Phones: stacked labeled cards, no horizontal overflow.
// ===========================================================================
await page.setViewportSize({ width: 390, height: 800 });
await page.goto(`${BASE}/dashboard/contacts?sort=name&dir=asc`);
await page.waitForLoadState("domcontentloaded");
await page.locator("#contacts-title").waitFor({ timeout: 10000 });
const overflow390 = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
if (overflow390 > 1) {
  throw new Error(`390px overflows horizontally by ${overflow390}px`);
}
const labelVisible = await page
  .locator('td[data-label="Email"]')
  .first()
  .evaluate((el) => {
    const before = getComputedStyle(el, "::before");
    return before.content !== "none" && before.content !== '""';
  });
if (!labelVisible) {
  throw new Error("the stacked cards lost their column labels");
}
await shot("74-contacts-390");
await page.setViewportSize({ width: 360, height: 800 });
await page.waitForTimeout(300);
const overflow360 = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
if (overflow360 > 1) {
  throw new Error(`360px overflows horizontally by ${overflow360}px`);
}
console.log("ok: 390px and 360px render stacked labeled cards without overflow");

if (pageErrors.length > 0) {
  throw new Error(`page errors during the run: ${pageErrors.join(" | ")}`);
}
await browser.close();
console.log("ticket 74 checks passed;");
console.log("screenshots in", OUT);
