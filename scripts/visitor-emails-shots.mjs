// Ticket 53 verification (headless Chromium): the Visitor emails page.
// Signs the owner in through the real UI, seeds 12 conversations with
// follow-up emails (plus 2 without, which must never surface), and asserts
// the 10-row page, newest-first order, whole-row links into the desk, the
// pane's "Follow-up email" meta line, URL-driven navigation with junk
// fallbacks, and the empty state without a pager. Captures screenshots at
// 1280/760/390/360 with zero overflow.
// Usage: node scripts/visitor-emails-shots.mjs <outdir> [port]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import process from "node:process";
import { signIn } from "./lib/shot-driver.mjs";

const OUT = process.argv[2] ?? ".scratch/college-website-chat/references/shots-emails";
const PORT = process.argv[3] ?? "3215";
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = process.env.CHATBOT_DB ?? ".scratch/college-website-chat/emails-demo.db";
const USERNAME = "owner";
const PASSWORD = "Springfield2026!";
const PAGE_URL = `${BASE}/dashboard/emails`;

/** 12 email-bearing conversations (varied states) + 2 without an email. */
function seedConversations() {
  const conn = new DatabaseSync(DB_PATH);
  const base = Date.now();
  const states = ["awaiting_staff", "claimed", "bot_active", "closed"];
  for (let index = 0; index < 12; index += 1) {
    const id = crypto.randomUUID();
    const createdAt = new Date(base - 600_000).toISOString();
    conn
      .prepare(
        "INSERT INTO conversations (id, state, created_at, visitor_last_seen_at, last_activity_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, states[index % states.length], createdAt, createdAt, createdAt);
    conn
      .prepare("UPDATE conversations SET visitor_email = ? WHERE id = ?")
      .run(`visitor${String(index).padStart(2, "0")}@example.edu`, id);
    // Activity steps 1s apart so the newest-first order is total.
    conn
      .prepare("UPDATE conversations SET last_activity_at = ? WHERE id = ?")
      .run(new Date(base + index * 1000).toISOString(), id);
  }
  for (let index = 0; index < 2; index += 1) {
    const id = crypto.randomUUID();
    const createdAt = new Date(base - 300_000).toISOString();
    conn
      .prepare(
        "INSERT INTO conversations (id, state, created_at, visitor_last_seen_at, last_activity_at) VALUES (?, 'bot_active', ?, ?, ?)",
      )
      .run(id, createdAt, createdAt, createdAt);
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

// Any chatbot route initializes the service singleton (migrations + seeds);
// the wipe below needs those tables to exist, so warm FIRST.
const warm = await fetch(`${BASE}/api/v1/topics`);
if (!warm.ok) throw new Error(`topics fetch failed: ${warm.status}`);

// A clean slate for the pieces this script owns: every conversation (this
// demo database exists for this script alone). No enrollment wipe
// (ticket 80): staff credentials live in hosted Supabase Auth, not a store
// table, so the sign-in below requires a freshly bootstrapped owner.
const db = new DatabaseSync(DB_PATH);
db.prepare("DELETE FROM conversations").run();
db.close();

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

// --- Seed 12 email rows; the pager's first page must lead with visitor11. -
seedConversations();
const expectedFirst = "visitor11@example.edu";
const expectedPage2First = "visitor01@example.edu";
const expectedLast = "visitor00@example.edu";
console.log("seeded 12 email conversations (+2 without an email)");

const rows = page.locator('[class*="emailList"] > li');
const pager = page.locator('nav[aria-label="Visitor emails pages"]');

async function gotoAndWait(url) {
  await page.goto(url);
  await page.waitForLoadState("domcontentloaded");
  // The section heading (the sidebar shell also renders the page title as
  // an h1 with the same name).
  await page.locator("#emails-title").waitFor({ timeout: 10000 });
}

// --- Page 1: ten rows, newest first, pager present. ------------------------
await gotoAndWait(PAGE_URL);
if ((await rows.count()) !== 10) {
  throw new Error(`page 1 must show exactly 10 rows, found ${await rows.count()}`);
}
const firstRowText = await rows.first().innerText();
if (!firstRowText.includes(expectedFirst)) {
  throw new Error(`page 1 does not lead with the newest activity: ${firstRowText.slice(0, 80)}`);
}
// Every row is one link to its conversation; the address renders as text.
const firstLink = rows.first().locator("a");
if ((await firstLink.count()) !== 1) {
  throw new Error("an email row is not exactly one whole-row link");
}
if (!(await firstLink.first().getAttribute("href")).match(/\/dashboard\/inbox\/[0-9a-f-]{36}$/)) {
  throw new Error("the row link does not target the conversation desk");
}
const currentState = await pager.locator('[aria-current="page"]').innerText();
if (currentState.trim() !== "1") {
  throw new Error(`page 1 is not marked aria-current (found "${currentState}")`);
}
console.log("ok: page 1 shows the 10 newest rows as whole-row links");

// --- The row link opens the desk with the pane's follow-up email line. -----
await rows.first().locator("a").click();
await page.waitForURL("**/dashboard/inbox/**", { timeout: 10000 });
await page.getByText("Follow-up email").waitFor({ timeout: 10000 });
const paneText = await page.locator('[aria-label="Selected conversation"]').innerText();
if (!paneText.includes("visitor11@example.edu")) {
  throw new Error("the pane header does not show the visitor's follow-up email");
}
console.log("ok: the desk pane header shows the follow-up email");

// --- Page 2 via the numbered link, then Next to the end. --------------------
await gotoAndWait(`${PAGE_URL}?page=1`);
await pager.getByRole("link", { name: "2", exact: true }).click();
await page.waitForURL("**/dashboard/emails?page=2", { timeout: 10000 });
await rows.first().waitFor({ timeout: 10000 });
if ((await rows.count()) !== 2) {
  throw new Error(`page 2 must show the remaining 2 rows, found ${await rows.count()}`);
}
if (!(await rows.first().innerText()).includes(expectedPage2First)) {
  throw new Error("page 2 does not continue the newest-first order");
}
if (!(await rows.last().innerText()).includes(expectedLast)) {
  throw new Error("page 2 does not end with the oldest entry");
}
if ((await pager.getByRole("link", { name: "Next →" }).count()) !== 0) {
  throw new Error("Next must be omitted on the last page");
}
console.log("ok: page 2 continues the order; no dead Next on the last page");

// --- Junk, zero, negative, and out-of-range params fall back to page 1. ----
for (const junk of ["abc", "0", "-2", "99", "2.5", ""]) {
  await gotoAndWait(`${PAGE_URL}?page=${junk}`);
  const marked = await pager.locator('[aria-current="page"]').innerText();
  if (marked.trim() !== "1") {
    throw new Error(`?page=${junk} did not fall back to page 1 (current: "${marked}")`);
  }
}
console.log("ok: junk/zero/negative/out-of-range page params all fall back to page 1");

// --- The sidebar nav entry. -------------------------------------------------
await gotoAndWait(`${PAGE_URL}?page=2`);
const navLink = page.getByRole("link", { name: "Visitor emails" }).first();
if ((await navLink.count()) !== 1) {
  throw new Error("the Visitor emails nav option is missing");
}
await navLink.click();
await page.waitForURL("**/dashboard/emails", { timeout: 10000 });
await rows.first().waitFor({ timeout: 10000 });
if ((await rows.count()) !== 10) {
  throw new Error("the no-parameter nav link did not land on the canonical first page");
}
console.log("ok: the nav entry lands on the canonical first page");

// --- Empty state: no rows, no pager. ----------------------------------------
{
  const conn = new DatabaseSync(DB_PATH);
  conn.prepare("DELETE FROM conversations").run();
  conn.close();
}
await gotoAndWait(PAGE_URL);
await page.getByText("No visitor emails yet").waitFor({ timeout: 10000 });
if ((await pager.count()) !== 0) {
  throw new Error("the empty list must not render pagination controls");
}
console.log("ok: empty state renders with no pager");

// --- Responsive pass with screenshots (re-seed for the visual). -------------
seedConversations();

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
await shotAt(1280, 900, PAGE_URL, "after-emails-1280");
await shotAt(760, 900, `${PAGE_URL}?page=2`, "after-emails-page2-760");
await shotAt(390, 900, PAGE_URL, "after-emails-390");
await shotAt(360, 800, `${PAGE_URL}?page=2`, "after-emails-360");

// The pane shot: the follow-up email line in the desk's header meta.
await page.setViewportSize({ width: 1280, height: 900 });
await gotoAndWait(`${PAGE_URL}`);
await rows.first().locator("a").click();
await page.waitForURL("**/dashboard/inbox/**", { timeout: 10000 });
await page.getByText("Follow-up email").waitFor({ timeout: 10000 });
await page.waitForTimeout(350);
await page.screenshot({ path: join(OUT, "after-emails-pane-1280.png"), fullPage: true });
console.log("captured after-emails-pane-1280");

if (pageErrors.length > 0) {
  throw new Error(`page errors during the run: ${pageErrors.join(" | ")}`);
}
await browser.close();
console.log("ticket 53 checks passed; screenshots in", OUT);
