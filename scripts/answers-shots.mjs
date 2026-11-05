// Ticket 55 verification (headless Chromium): the redesigned Answers tab.
// Signs the owner in through the real UI, seeds a few extra rules for variety,
// then — in certify mode — asserts the three tabs (Answer Rules default),
// no-refresh switching, live case-insensitive search with its empty state,
// compact expandable cards (aria-expanded, keyboard toggle, Edit navigation),
// the header New answer button, and the preserved save flows for handoff
// phrases and the welcome message through the real endpoints. Captures
// screenshots at 1280/760/390/360 with zero overflow. In before mode it only
// signs in and captures the pre-redesign page.
// Usage: node scripts/answers-shots.mjs <outdir> [port] [before]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { TOTP, URI } from "otpauth";
import process from "node:process";

const OUT = process.argv[2] ?? ".scratch/college-website-chat/references/shots-answers";
const PORT = process.argv[3] ?? "3216";
const BEFORE = process.argv[4] === "before";
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = process.env.CHATBOT_DB ?? ".scratch/college-website-chat/answers-demo.db";
const EMAIL = "owner@example.edu";
const PASSWORD = "Springfield2026!";
const PAGE_URL = `${BASE}/dashboard/answers`;

/** Fixed-id rows the service's insert-if-absent seed keeps restoring: each
    process that initializes its own module registry (next start's render
    workers do) seeds them again. Certification deletes them by id and
    reloads, so counts stay exact regardless of worker topology. */
const SEED_IDS = ["admissions-overview", "fees-overview", "scholarships-overview"];

function deleteSeedRows() {
  const conn = new DatabaseSync(DB_PATH);
  const placeholders = SEED_IDS.map(() => "?").join(",");
  conn.prepare(`DELETE FROM answer_rules WHERE id IN (${placeholders})`).run(...SEED_IDS);
  conn.close();
}

/** Five rules with targetable text: the three seed topics plus two extras. */
function seedExtraRules() {
  const conn = new DatabaseSync(DB_PATH);
  const at = new Date().toISOString();
  const extras = [
    {
      topic: "Admissions",
      response:
        "You can apply online through our admissions portal. Undergraduate applications ask for your high school transcript and one reference letter. See the admissions page for the full checklist.",
      phrases: ["What are the admission requirements", "How do I apply"],
    },
    {
      topic: "Fees",
      response:
        "Tuition for most programs is $3,500 per semester. See the fees page for the current schedule.",
      phrases: ["Tuition fees", "Fees"],
    },
    {
      topic: "Scholarships",
      response:
        "Springfield College offers merit scholarships and need-based grants. File the FAFSA by March 1 to be considered for every award.",
      phrases: ["Scholarships", "Financial aid"],
    },
    {
      topic: "Campus parking",
      response:
        "Visitor parking sits in the North Garage on Elm Street. Day passes are available at the gate, and accessible spaces are next to every elevator lobby.",
      phrases: ["parking", "where can I park"],
    },
    {
      topic: "Library hours",
      response:
        "The main library opens 8am to midnight on weekdays and 10am to 10pm on weekends during term. Hours change over the summer and between semesters.",
      phrases: ["library hours", "when is the library open"],
    },
  ];
  for (const extra of extras) {
    conn
      .prepare(
        `INSERT INTO answer_rules (id, topic, response, link, phrases, keywords, status, updated_at, published_by, reviewed_at)
         VALUES (?, ?, ?, NULL, ?, NULL, 'published', ?, NULL, ?)`,
      )
      .run(
        crypto.randomUUID(),
        extra.topic,
        extra.response,
        JSON.stringify(extra.phrases),
        at,
        at,
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

// Any chatbot route initializes the service singleton (migrations + seeds);
// the wipe below needs those tables to exist, so warm FIRST.
const warm = await fetch(`${BASE}/api/v1/topics`);
if (!warm.ok) throw new Error(`topics fetch failed: ${warm.status}`);

const db = new DatabaseSync(DB_PATH);
const owner = db.prepare('SELECT id FROM "user" WHERE email = ?').get(EMAIL);
if (owner) {
  db.prepare("DELETE FROM twoFactor WHERE userId = ?").run(owner.id);
  db.prepare('UPDATE "user" SET "twoFactorEnabled" = 0 WHERE id = ?').run(owner.id);
  db.prepare('DELETE FROM "session" WHERE "userId" = ?').run(owner.id);
}
db.prepare("DELETE FROM answer_rules").run();
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

// --- Seed the five rules this script's assertions name. --------------------
seedExtraRules();
deleteSeedRows();
await gotoAndWait();
// A render worker initialized by this very navigation may have re-seeded
// its fixed-id rows; drop them and re-render so the counts are exact.
deleteSeedRows();
await gotoAndWait();

async function gotoAndWait() {
  await page.goto(PAGE_URL);
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("link", { name: "New answer" }).waitFor({ timeout: 10000 });
}

async function shotAt(width, height, name) {
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

if (BEFORE) {
  await gotoAndWait();
  await shotAt(1280, 900, "before-answers-1280");
  await shotAt(760, 900, "before-answers-760");
  await shotAt(390, 900, "before-answers-390");
  if (pageErrors.length > 0) throw new Error(`page errors: ${pageErrors.join(" | ")}`);
  await browser.close();
  console.log("before shots captured in", OUT);
  process.exit(0);
}

// --- Certify the redesigned page. ------------------------------------------

// Tabs: three labelled tabs, Answer Rules selected by default.
await gotoAndWait();
const tabs = page.getByRole("tablist").first();
const tabNames = await tabs.getByRole("tab").allInnerTexts();
if (
  tabNames.length !== 3 ||
  !tabNames[0].includes("Answer Rules") ||
  !tabNames[1].includes("Handoff Phrases") ||
  !tabNames[2].includes("Welcome Message")
) {
  throw new Error(`expected the three tabs, found: ${tabNames.join(" / ")}`);
}
const selected = await tabs.locator('[aria-selected="true"]').innerText();
if (!selected.includes("Answer Rules")) {
  throw new Error(`Answer Rules must be the default tab, found: ${selected}`);
}
const newAnswer = page.getByRole("link", { name: "New answer" });
if (!(await newAnswer.isVisible())) {
  throw new Error("the New answer button is missing");
}
console.log("ok: three tabs with Answer Rules default; New answer present");

// Cards render collapsed with the five seeded topics visible.
const cards = page.locator('[class*="answersList"] > li');
const cardCount = await cards.count();
if (cardCount !== 5) {
  throw new Error(`expected 5 answer cards, found ${cardCount}`);
}
const firstToggle = cards.first().getByRole("button", { expanded: false }).first();
if ((await firstToggle.getAttribute("aria-expanded")) !== "false") {
  throw new Error("cards must start collapsed");
}
// Collapsed cards show the two-line preview and the phrase count.
if (!(await cards.first().innerText()).match(/\d+ phrase/)) {
  throw new Error("a collapsed card does not show its phrase count");
}

// Expanding reveals the full response, review trail, and the Edit action.
await firstToggle.click();
const expandedPanel = cards.first().locator('[role="region"], [class*="answersCardBody"]').first();
await expandedPanel.waitFor({ timeout: 5000 });
const expandedText = await cards.first().innerText();
if (!expandedText.includes("Published by") && !expandedText.includes("reviewed")) {
  throw new Error("the expanded card does not show publisher/review metadata");
}
const editLink = cards.first().getByRole("link", { name: /Edit answer|Edit/ }).first();
if (!(await editLink.isVisible())) {
  throw new Error("the expanded card does not expose an Edit action");
}
const editHref = await editLink.getAttribute("href");
if (!editHref || !editHref.match(/\/dashboard\/answers\/[0-9a-f-]{36}$/)) {
  throw new Error(`the Edit action does not target the editor: ${editHref}`);
}
console.log("ok: cards expand with metadata and a working Edit action");

// Keyboard: the toggle is a real button — focus it and press Enter on another card.
const secondToggle = cards.nth(1).locator("button").first();
await secondToggle.focus();
await page.keyboard.press("Enter");
if ((await secondToggle.getAttribute("aria-expanded")) !== "true") {
  throw new Error("Enter does not expand the focused card");
}
await page.keyboard.press("Enter");
if ((await secondToggle.getAttribute("aria-expanded")) !== "false") {
  throw new Error("Enter does not collapse the focused card");
}
console.log("ok: keyboard focus + Enter expands and collapses");

// Search filters live, case-insensitively, with an empty state.
const search = page.getByRole("searchbox");
await search.fill("SCHOLAR");
await page.waitForTimeout(200);
const filtered = await cards.count();
if (filtered !== 1 || !(await cards.first().innerText()).includes("Scholarships")) {
  throw new Error(`case-insensitive search did not isolate Scholarships (found ${filtered})`);
}
await search.fill("zzzz-nothing");
await page.waitForTimeout(200);
if (!(await page.getByText("No answers match").count())) {
  throw new Error("search with no matches shows no empty state");
}
await search.fill("");
await page.waitForTimeout(200);
if ((await cards.count()) !== 5) {
  throw new Error("clearing search does not restore every card");
}
console.log("ok: live case-insensitive search with an empty state");

// Tab switching happens without navigation (the URL never changes), and
// the inactive panels actually leave the render.
const rulesSearch = page.getByRole("searchbox");
const phrasesTab = tabs.getByRole("tab", { name: /Handoff Phrases/ });
await phrasesTab.click();
const phrasesBox = page.locator("#escalation-phrases");
await phrasesBox.waitFor({ timeout: 5000 });
await rulesSearch.waitFor({ state: "hidden", timeout: 5000 });
if (!page.url().includes("/dashboard/answers")) {
  throw new Error("tab switching navigated away");
}
const phrasesSelected = await phrasesTab.getAttribute("aria-selected");
if (phrasesSelected !== "true") {
  throw new Error("the phrases tab is not marked selected");
}

// The preserved save flow works through the real endpoint.
await phrasesBox.fill("financial aid\nbursary office");
await page.getByRole("button", { name: "Save phrases" }).click();
await page.getByText("Handoff phrases saved.").waitFor({ timeout: 10000 });
console.log("ok: handoff phrases tab preserves its save flow");

// Welcome message tab likewise.
await tabs.getByRole("tab", { name: /Welcome Message/ }).click();
const welcomeBox = page.locator("#welcome-message");
await welcomeBox.waitFor({ timeout: 5000 });
await welcomeBox.fill("Hello! How can the college help you today?");
await page.getByRole("button", { name: "Save welcome message" }).click();
await page.getByText("Welcome message saved.").waitFor({ timeout: 10000 });
console.log("ok: welcome message tab preserves its save flow");

// --- Responsive pass on the rules tab. --------------------------------------
await tabs.getByRole("tab", { name: /Answer Rules/ }).click();
await page.getByRole("searchbox").waitFor({ timeout: 5000 });
await page.locator("#escalation-phrases").waitFor({ state: "hidden", timeout: 5000 });
await shotAt(1280, 900, "after-answers-1280");
await shotAt(760, 900, "after-answers-760");
await shotAt(390, 900, "after-answers-390");
await shotAt(360, 800, "after-answers-360");

if (pageErrors.length > 0) {
  throw new Error(`page errors during the run: ${pageErrors.join(" | ")}`);
}
await browser.close();
console.log("ticket 55 checks passed; screenshots in", OUT);
