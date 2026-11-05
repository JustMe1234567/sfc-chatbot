// Ticket 50 verification (headless Chromium): the Delivery history pager.
// Signs the owner in through the real UI, seeds 23 notifications (distinct,
// targetable row text), and asserts the 10-row page, URL-driven navigation,
// junk/out-of-range fallbacks, totals that count everything, retry from a
// non-first page through the real endpoint, and the empty state without a
// pager. Captures after screenshots at 1280/760/390/360 with zero overflow.
// Usage: node scripts/notifications-pager-shots.mjs <outdir> [port]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { TOTP, URI } from "otpauth";
import process from "node:process";

const OUT = process.argv[2] ?? ".scratch/college-website-chat/references/shots-pager";
const PORT = process.argv[3] ?? "3214";
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = process.env.CHATBOT_DB ?? ".scratch/college-website-chat/pager-demo.db";
const EMAIL = "owner@example.edu";
const PASSWORD = "Springfield2026!";
const PAGE_URL = `${BASE}/dashboard/notifications`;

/** 23 notifications (16 sent / 4 failed / 3 pending) with targetable rows. */
function seedNotifications() {
  const conn = new DatabaseSync(DB_PATH);
  const base = Date.now();
  for (let index = 0; index < 23; index += 1) {
    const conversationId = crypto.randomUUID();
    conn
      .prepare("INSERT INTO conversations (id, state, created_at) VALUES (?, 'closed', ?)")
      .run(conversationId, new Date(base - 60_000).toISOString());
    const status = index < 3 ? "pending" : index < 7 ? "failed" : "sent";
    conn
      .prepare(
        `INSERT INTO notifications (id, type, conversation_id, recipients, status, attempts, last_error, created_at)
         VALUES (?, 'escalation_alert', ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        conversationId,
        JSON.stringify([`row-${index}@example.edu`]),
        status,
        status === "failed" ? `SMTP 451 row ${index}` : null,
        new Date(base + index * 1000).toISOString(),
      );
  }
  conn.close();
}

for (let attempt = 0; ; attempt++) {
  try {
    await fetch(`${BASE}/api/healthz`);
    break;
  } catch {
    if (attempt > 40) throw new Error("server never came up");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// A clean slate for the pieces this script owns: enrollment, the alert
// history, and the orphan conversations earlier runs seeded as FK anchors
// (conversations with messages — from real visitor traffic — are kept).
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
db.prepare("DELETE FROM notifications").run();
db.prepare("DELETE FROM settings WHERE key = 'alert_recipients'").run();
db.prepare(
  `DELETE FROM conversations WHERE id NOT IN (SELECT conversation_id FROM messages)
     AND id NOT IN (SELECT conversation_id FROM visitor_sessions)
     AND id NOT IN (SELECT conversation_id FROM return_tokens)`,
).run();
db.close();

// Any chatbot route initializes the service singleton (migrations + seeds).
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

// --- Seed 23 notifications with per-row targetable text. ------------------
// created_at steps 1s apart so the newest-first order is total. Every row's
// visible line is unique: sent/pending rows show "Sent to row-<n>@", failed
// rows show "SMTP 451 row <n>".
seedNotifications();
// The newest-first identities the pager must honour (seeds 13..22 on page 1).
const expectedFirst = "row-22@example.edu";
const expectedPage2First = "row-12@example.edu";
const expectedLast = "row-0@example.edu";
console.log("seeded 23 notifications (16 sent / 4 failed / 3 pending)");

const rows = page.locator('[class*="alertList"] > li');
const pager = page.locator('nav[aria-label="Delivery history pages"]');

async function gotoAndWait(url) {
  await page.goto(url);
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("heading", { name: "Delivery history" }).waitFor({ timeout: 10000 });
}

// --- Page 1: ten rows, newest first, pager present. ------------------------
await gotoAndWait(PAGE_URL);
if ((await rows.count()) !== 10) {
  throw new Error(`page 1 must show exactly 10 rows, found ${await rows.count()}`);
}
const firstRowText = await rows.first().innerText();
if (!firstRowText.includes(expectedFirst)) {
  throw new Error(`page 1 does not lead with the newest attempt: ${firstRowText.slice(0, 80)}`);
}
if (!(await page.getByText("16 delivered").count())) {
  throw new Error("the delivered badge does not count all 16 sent notifications");
}
if (!(await page.getByText("4 failed").count())) {
  throw new Error("the failed badge does not count all 4 failed notifications");
}
const current = await pager.locator('[aria-current="page"]').innerText();
if (current.trim() !== "1") {
  throw new Error(`page 1 is not marked aria-current (found "${current}")`);
}
if ((await pager.getByRole("link", { name: "← Previous" }).count()) !== 0) {
  throw new Error("Previous must not render on page 1");
}
console.log("ok: page 1 shows the 10 newest rows; totals count everything; no Previous");

// --- page=1 and no parameter render the same first page. -------------------
await gotoAndWait(`${PAGE_URL}?page=1`);
if (!(await rows.first().innerText()).includes(expectedFirst)) {
  throw new Error("?page=1 renders a different first page than no parameter");
}

// --- Numbered and Next navigation. -----------------------------------------
// Page 2 via its numbered link (Next exists here; aria-current follows).
await pager.getByRole("link", { name: "2", exact: true }).click();
await page.waitForURL("**/dashboard/notifications?page=2", { timeout: 10000 });
await rows.first().waitFor({ timeout: 10000 });
if ((await rows.count()) !== 10) {
  throw new Error(`page 2 must show 10 rows, found ${await rows.count()}`);
}
if (!(await rows.first().innerText()).includes(expectedPage2First)) {
  throw new Error("page 2 does not continue the newest-first order");
}
const marked2 = await pager.locator('[aria-current="page"]').innerText();
if (marked2.trim() !== "2") {
  throw new Error(`page 2 is not marked aria-current (found "${marked2}")`);
}
// Next steps to the last page, where it must vanish (no dead links).
await pager.getByRole("link", { name: "Next →" }).click();
await page.waitForURL("**/dashboard/notifications?page=3", { timeout: 10000 });
await rows.first().waitFor({ timeout: 10000 });
if ((await rows.count()) !== 3) {
  throw new Error(`page 3 must show the remaining 3 rows, found ${await rows.count()}`);
}
if (!(await rows.last().innerText()).includes(expectedLast)) {
  throw new Error("page 3 does not end with the oldest attempt");
}
if ((await pager.getByRole("link", { name: "Next →" }).count()) !== 0) {
  throw new Error("Next must be omitted on the last page");
}
// Three pages ≤ the 7-page threshold: every page shows as a numbered link
// with no gaps (the windowed-with-gaps shape is pinned in the unit tests).
if (await pager.locator('[class*="pagerGap"]').count() !== 0) {
  throw new Error("a 3-page history must not show windowing gaps");
}
const numbered = await pager.getByRole("link", { name: /^\d+$/ }).count();
if (numbered !== 3) {
  throw new Error(`expected the three numbered page links, found ${numbered}`);
}
// Previous steps back to a full page 2.
await pager.getByRole("link", { name: "← Previous" }).click();
await page.waitForURL("**/dashboard/notifications?page=2", { timeout: 10000 });
await rows.first().waitFor({ timeout: 10000 });
if ((await rows.count()) !== 10) {
  throw new Error(`Previous did not land on a full page 2 (${await rows.count()} rows)`);
}
console.log("ok: numbered links, Next→last (then omitted), Previous→page 2, order holds");

// --- Junk, zero, negative, and out-of-range params fall back to page 1. ----
for (const junk of ["abc", "0", "-2", "99", "2.5", ""]) {
  await gotoAndWait(`${PAGE_URL}?page=${junk}`);
  const marked = await pager.locator('[aria-current="page"]').innerText();
  if (marked.trim() !== "1") {
    throw new Error(`?page=${junk} did not fall back to page 1 (current: "${marked}")`);
  }
  if ((await rows.count()) !== 10) {
    throw new Error(`?page=${junk} fallback did not render page 1's 10 rows`);
  }
}
console.log("ok: junk/zero/negative/out-of-range page params all fall back to page 1");

// --- An inbound link without the parameter still lands on page 1. ----------
// From page 3, the shared header's Email alerts nav pill carries no ?page;
// following it must render the canonical first page.
await gotoAndWait(`${PAGE_URL}?page=3`);
await page.getByRole("link", { name: "Email alerts" }).click();
await page.waitForURL("**/dashboard/notifications", { timeout: 10000 });
await rows.first().waitFor({ timeout: 10000 });
const afterNav = await pager.locator('[aria-current="page"]').innerText();
if (afterNav.trim() !== "1") {
  throw new Error(`the no-parameter nav link did not land on page 1 (current: "${afterNav}")`);
}
console.log("ok: the header nav link (no page param) lands on the canonical first page");

// --- Retry from a non-first page through the real endpoint. ----------------
// Page 2 holds seeds 3..6 failed; retrying one must deliver, update the
// totals (16→17 delivered, 4→3 failed), and keep the URL on page 2.
await gotoAndWait(`${PAGE_URL}?page=2`);
const retryButton = page.getByRole("button", { name: "Retry delivery" }).first();
await retryButton.click();
await page.getByText("17 delivered").waitFor({ timeout: 10000 });
if (!page.url().includes("page=2")) {
  throw new Error(`retry knocked the view off page 2: ${page.url()}`);
}
if ((await rows.count()) !== 10) {
  throw new Error("retry changed the page's row count");
}
console.log("ok: retry works from page 2, totals update, the view stays on page 2");

// --- Empty state: no rows, no pager. ----------------------------------------
{
  const conn = new DatabaseSync(DB_PATH);
  conn.prepare("DELETE FROM notifications").run();
  conn.close();
}
await gotoAndWait(PAGE_URL);
await page.getByText("No email alerts yet").waitFor({ timeout: 10000 });
if ((await pager.count()) !== 0) {
  throw new Error("the empty history must not render pagination controls");
}
console.log("ok: empty state renders with no pager");

// --- Responsive pass with screenshots (re-seed for the visual). ------------
seedNotifications();

async function shotAt(width, height, url, name) {
  await gotoAndWait(url);
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(350);
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.scrollingElement.scrollWidth,
    clientWidth: document.scrollingElement.clientWidth,
  }));
  if (overflow.scrollWidth > overflow.clientWidth + 1) {
    const culprits = await page.evaluate(() => {
      const viewport = document.scrollingElement.clientWidth;
      const wide = [];
      for (const element of document.querySelectorAll("body *")) {
        const rect = element.getBoundingClientRect();
        if (rect.right > viewport + 1 && rect.width > 40) {
          wide.push(
            `${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0]} w=${Math.round(rect.width)}`,
          );
        }
        if (wide.length >= 5) break;
      }
      return wide.join(" | ");
    });
    throw new Error(`horizontal page overflow at ${width}px on ${name} — widest: ${culprits}`);
  }
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  console.log("captured", name);
}
await shotAt(1280, 900, PAGE_URL, "after-pager-1280");
await shotAt(760, 900, `${PAGE_URL}?page=2`, "after-pager-page2-760");
await shotAt(390, 900, PAGE_URL, "after-pager-390");
await shotAt(360, 800, `${PAGE_URL}?page=3`, "after-pager-360");

if (pageErrors.length > 0) {
  throw new Error(`page errors during the run: ${pageErrors.join(" | ")}`);
}
await browser.close();
console.log("ticket 50 checks passed; screenshots in", OUT);
