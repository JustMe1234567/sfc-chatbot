// Ticket 47 verification (headless Chromium): History shows the same compact
// clickable rows as the live desk, and transcript retention defaults to
// 30 days when no owner period is set. Signs the owner in through the real
// UI, seeds closed conversations through the real APIs, drives the History
// tab at desktop/tablet/phone widths, and exercises the retention form's
// real save/reset endpoints (the save's immediate sweep is the browser-level
// proof that the period change takes effect on old closed conversations).
//
// --before captures the pre-change UI only (old copy, no new assertions);
// the default run is the full certification of the implemented ticket.
// Usage: node scripts/history-retention-shots.mjs <outdir> [port] [--before]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import process from "node:process";
import { signIn } from "./lib/shot-driver.mjs";

const OUT = process.argv[2] ?? ".scratch/college-website-chat/references/shots-history";
const BEFORE = process.argv.includes("--before");
const PORT = process.argv[3] && process.argv[3] !== "--before" ? process.argv[3] : "3213";
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = process.env.CHATBOT_DB ?? ".scratch/college-website-chat/history-demo.db";
const USERNAME = "owner";
const PASSWORD = "Springfield2026!";
let SEED_IDS = null;

for (let attempt = 0; ; attempt++) {
  try {
    await fetch(`${BASE}/api/healthz`);
    break;
  } catch {
    if (attempt > 40) throw new Error("server never came up");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// A clean slate for the pieces this ticket owns. Conversations cannot be
// deleted (foreign keys), so reruns tolerate leftover rows: every count
// assertion is relative to this run's own seeds, and a prior run's
// backdated rows are swept by this run's form save. No enrollment wipe
// (ticket 80): staff credentials live in hosted Supabase Auth, not a store
// table, so the sign-in below requires a freshly bootstrapped owner.
const db = new DatabaseSync(DB_PATH);
db.prepare("DELETE FROM settings WHERE key = 'transcript_retention_days'").run();
db.prepare("DELETE FROM retention_runs").run();
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

// --- Sign the owner in through the real UI (password-only since 82). ------
await signIn(page, BASE, USERNAME, PASSWORD);
mkdirSync(OUT, { recursive: true });

// --- Seed closed conversations through the real APIs. ---------------------
// Escalate (the seeded default phrase), take over, reply, close — the exact
// lifecycle staff produce. The staff note is each row's last message, so
// every compact row has a distinctive, targetable preview; one row is then
// backdated past the default for the sweep proof.
const SEEDS = [
  // (ids land in SEED_IDS once the API lifecycle has run)
  {
    key: "recentA",
    question: "What time does the library close during finals week?",
    note: "The library stays open until midnight during finals week.",
  },
  {
    key: "recentB",
    question: "How do I request an official transcript copy?",
    note: "Transcript copies are requested through the registrar portal.",
  },
  {
    key: "ancient",
    question: "Is the gym open to students on weekends?",
    note: "The gym opens to students at 8am on weekends.",
  },
];
{
  const made = await page.evaluate(async (conversations) => {
    const results = {};
    for (const item of conversations) {
      const started = await fetch("/api/v1/conversations", { method: "POST" });
      const conversation = await started.json();
      const post = (text) =>
        fetch(`/api/v1/conversations/${conversation.id}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${conversation.token}`,
          },
          body: JSON.stringify({ text }),
        });
      for (const [step, response] of Object.entries({
        question: await post(item.question),
        escalate: await post("Please let me speak to a human."),
      })) {
        if (!response.ok) throw new Error(`seeding ${item.key}: ${step} failed`);
      }
      const staff = async (action, body) =>
        fetch(`/api/staff/conversations/${conversation.id}/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      for (const [step, response] of Object.entries({
        claim: await staff("claim"),
        reply: await staff("reply", { text: item.note }),
        close: await staff("close"),
      })) {
        if (!response.ok) throw new Error(`seeding ${item.key}: ${step} failed`);
      }
      results[item.key] = { id: conversation.id };
    }
    return results;
  }, SEEDS);
  SEED_IDS = made;
  const back = new DatabaseSync(DB_PATH);
  back
    .prepare("UPDATE conversations SET closed_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(), made.ancient.id);
  back.close();
  console.log("seeded three closed conversations (one backdated 40 days)");
}

await page.goto(`${BASE}/dashboard/inbox/history`);
await page.waitForLoadState("domcontentloaded");
await page.locator('nav[aria-label="Conversation list"]').waitFor({ timeout: 10000 });

if (BEFORE) {
  // Pre-change documentation only: the old history page and the old
  // retention card ("kept indefinitely") before the ticket's changes.
  await page.screenshot({ path: join(OUT, "before-history-1280.png"), fullPage: true });
  await page.goto(`${BASE}/dashboard/settings`);
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("heading", { name: "Transcript retention" }).waitFor({ timeout: 10000 });
  await page.screenshot({ path: join(OUT, "before-retention-card-1280.png"), fullPage: true });
  console.log("before-shots captured");
  await browser.close();
  process.exit(0);
}

// --- Compact rows: one per conversation, clamped, never inline transcripts.
// Row previews carry the literal last message (the bot's closure note), so
// the rows are targeted structurally; the sweep proof works on seed ids.
const nav = page.locator('nav[aria-label="Conversation list"]');
const rows = nav.locator("a:has(time)");
const rowsBefore = await rows.count();
if (rowsBefore < 3) {
  throw new Error(`expected the three seeded history rows, found ${rowsBefore}`);
}
if ((await nav.locator('[class*="transcript"]').count()) !== 0) {
  throw new Error("full transcripts rendered inside the compact history list");
}
const clamp = await rows
  .first()
  .locator('[class*="deskItemPreview"]')
  .evaluate((el) => getComputedStyle(el).webkitLineClamp);
if (clamp !== "2") {
  throw new Error(`previews are not clamped to two lines (webkitLineClamp=${clamp})`);
}
const rowA11y = await rows.first().evaluate((el) => ({
  title: el.hasAttribute("title"),
  label: el.hasAttribute("aria-label"),
}));
if (rowA11y.title || rowA11y.label) {
  throw new Error("the list row carries a tooltip or an accessible name");
}
console.log("ok: compact rows with clamped previews, no inline transcripts");

// --- Selecting a row opens the transcript in the pane, only one selected. --
await rows.first().click();
const pane = page.locator('section[aria-label="Selected conversation"]');
await pane.locator('[class*="bubble"]').first().waitFor({ timeout: 10000 });
if ((await nav.locator('[data-selected]').count()) !== 1) {
  throw new Error("selection did not land on exactly one row");
}
if ((await nav.locator('[aria-current="true"]').count()) !== 1) {
  throw new Error("the selected row is not the single aria-current row");
}
const historyTabCurrent = await page
  .getByRole("link", { name: "History" })
  .getAttribute("aria-current");
if (historyTabCurrent !== "page") {
  throw new Error("a History-originated selection left the History tab");
}
if ((await nav.locator('[class*="transcript"]').count()) !== 0) {
  throw new Error("the transcript leaked into the list after selection");
}
const backHref = await page.locator('[class*="deskBack"]').getAttribute("href");
if (backHref !== "/dashboard/inbox/history") {
  throw new Error(`back link does not return to History (${backHref})`);
}
console.log("ok: row click opens the transcript in the pane, single selection, History context");

// --- Returning to History restores the compact list. -----------------------
await page.getByRole("link", { name: "History" }).click();
await rows.first().waitFor({ timeout: 10000 });
// The tab is a client-side navigation: wait for the re-render that clears
// the selection rather than for a load event.
await nav.locator('[data-selected]').waitFor({ state: "detached", timeout: 10000 });
if ((await nav.locator('[class*="transcript"]').count()) !== 0) {
  throw new Error("an expanded transcript survived returning to History");
}
console.log("ok: returning to History restores the compact list");

// --- Keyboard: a row is reachable and Enter opens it. ----------------------
await page.getByRole("link", { name: "History" }).focus();
for (let hop = 0; hop < 6; hop += 1) {
  await page.keyboard.press("Tab");
  const onRow = await page.evaluate(
    () => document.activeElement?.querySelector?.('[class*="deskItemPreview"]') != null,
  );
  if (onRow) break;
}
await page.keyboard.press("Enter");
await page.waitForLoadState("domcontentloaded");
await page.locator('section[aria-label="Selected conversation"] [class*="bubble"]').first().waitFor({ timeout: 10000 });
if ((await nav.locator('[aria-current="true"]').count()) !== 1) {
  throw new Error("keyboard selection did not set aria-current");
}
console.log("ok: keyboard navigation selects a row with visible focus semantics");

// --- The retention form states the default and warns about permanence. -----
await page.goto(`${BASE}/dashboard/settings`);
await page.getByRole("heading", { name: "Transcript retention" }).waitFor({ timeout: 10000 });
const form = page.locator("form", { has: page.getByRole("heading", { name: "Transcript retention" }) });
const placeholder = await page.locator("#retention-days").getAttribute("placeholder");
if (placeholder !== "30") {
  throw new Error(`the empty period input does not show the default (placeholder=${placeholder})`);
}
for (const phrase of ["default of 30 days", "permanently", "visitor email addresses"]) {
  if ((await form.getByText(phrase).count()) < 1) {
    throw new Error(`the retention card never says "${phrase}"`);
  }
}
const resetButton = form.getByRole("button", { name: "Reset to default" });
if ((await resetButton.count()) !== 1) {
  throw new Error("the retention card does not offer an honest reset-to-default control");
}
console.log("ok: the retention card states the 30-day default and the permanence warning");

// --- Saving a period sweeps through the real endpoint. ---------------------
// The backdated seed (closed 40 days ago) is past 35 days, so saving 35
// must remove exactly that conversation now. The exact purge is checked on
// the seed ids; the archive visibly shrinks and keeps the recent rows.
await page.fill("#retention-days", "35");
await form.getByRole("button", { name: "Save period" }).click();
await form.getByText(/removed now/).waitFor({ timeout: 10000 });
const survivor = new DatabaseSync(DB_PATH);
const stillThere = (id) =>
  survivor.prepare("SELECT COUNT(*) AS n FROM conversations WHERE id = ?").get(id).n;
if (stillThere(SEED_IDS.ancient.id) !== 0) {
  throw new Error("the 40-day-old closed conversation survived a 35-day period");
}
for (const key of ["recentA", "recentB"]) {
  if (stillThere(SEED_IDS[key].id) !== 1) {
    throw new Error(`the recent ${key} conversation was swept although it is only days old`);
  }
}
survivor.close();
await page.goto(`${BASE}/dashboard/inbox/history`);
await page.waitForLoadState("domcontentloaded");
const rowsAfter = await rows.count();
if (rowsAfter >= rowsBefore) {
  throw new Error(`the archive did not shrink after the sweep (${rowsBefore} -> ${rowsAfter})`);
}
console.log("ok: the period save swept the expired transcript through the real endpoint");

// --- Resetting to the default is honest and takes effect. ------------------
await page.goto(`${BASE}/dashboard/settings`);
await page.getByRole("heading", { name: "Transcript retention" }).waitFor({ timeout: 10000 });
await page.locator("form", { has: page.getByRole("heading", { name: "Transcript retention" }) })
  .getByRole("button", { name: "Reset to default" })
  .click();
await page.getByText("Retention reset to the 30-day default.").waitFor({ timeout: 10000 });
const stored = new DatabaseSync(DB_PATH)
  .prepare("SELECT COUNT(*) AS n FROM settings WHERE key = 'transcript_retention_days'")
  .get();
if (stored.n !== 0) {
  throw new Error("resetting left a retention row behind");
}
if ((await page.locator("#retention-days").inputValue()) !== "") {
  throw new Error("the form did not return to the empty (default) state");
}
console.log("ok: reset to default clears the explicit period and says what applies now");

// --- Responsive pass with screenshots. -------------------------------------
async function shotAt(width, height, url, name) {
  await page.goto(url);
  await page.waitForLoadState("domcontentloaded");
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
const historyUrl = `${BASE}/dashboard/inbox/history`;
await shotAt(1280, 900, historyUrl, "after-history-1280");
await shotAt(760, 900, historyUrl, "after-history-760");
await shotAt(390, 900, historyUrl, "after-history-390");
await shotAt(360, 800, historyUrl, "after-history-360");
await shotAt(
  1280,
  900,
  `${BASE}/dashboard/settings`,
  "after-retention-card-1280",
);

if (pageErrors.length > 0) {
  throw new Error(`page errors during the run: ${pageErrors.join(" | ")}`);
}
await browser.close();
console.log("ticket 47 checks passed; screenshots in", OUT);
