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
import process from "node:process";
import { signIn } from "./lib/shot-driver.mjs";

const OUT = process.argv[2] ?? ".scratch/college-website-chat/references/shots-answers";
const PORT = process.argv[3] ?? "3216";
const BEFORE = process.argv[4] === "before";
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = process.env.CHATBOT_DB ?? ".scratch/college-website-chat/answers-demo.db";
const USERNAME = "owner";
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

/** Six rules with targetable text: the three seed topics, two extras, and
    one draft so the status filter and the Draft badge have something to show.
    ownerId is a placeholder: crediting the real owner needs the hosted
    Postgres store this SQLite pass cannot reach (ticket 80). */
function seedExtraRules(ownerId) {
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
      keywords: [
        ["tuition"],
        ["fees"],
      ],
      link: "https://www.springfield.edu/fees",
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
    {
      topic: "Transcript requests",
      response:
        "Official transcripts are requested through the registrar's online form and are ready for pickup or mail within five business days.",
      phrases: ["transcript"],
      draft: true,
    },
  ];
  for (const extra of extras) {
    conn
      .prepare(
        `INSERT INTO answer_rules (id, topic, response, link, phrases, keywords, status, updated_at, published_by, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        extra.topic,
        extra.response,
        extra.link ?? null,
        JSON.stringify(extra.phrases),
        extra.keywords ? JSON.stringify(extra.keywords) : null,
        extra.draft ? "draft" : "published",
        at,
        extra.draft ? null : ownerId,
        extra.draft ? null : at,
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
// the rule reset below needs those tables to exist, so warm FIRST.
const warm = await fetch(`${BASE}/api/v1/topics`);
if (!warm.ok) throw new Error(`topics fetch failed: ${warm.status}`);

// No enrollment wipe and no owner-row lookup here (ticket 80): the store is
// hosted Postgres (staff in staff_members), which node:sqlite cannot reach —
// this script's SQLite seeding pass is parked on the run-substrate decision.
const db = new DatabaseSync(DB_PATH);
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

// --- Sign the owner in through the real UI (password-only since 82). ------
await signIn(page, BASE, USERNAME, PASSWORD);
mkdirSync(OUT, { recursive: true });

// --- Seed the six rules this script's assertions name. ----------------------
// published_by is a placeholder: the owner's id lives in the hosted Postgres
// store, unreachable from this SQLite seeding pass (ticket 80 substrate).
seedExtraRules(null);
deleteSeedRows();
await gotoAndWait();
// A render worker initialized by this very navigation may have re-seeded
// its fixed-id rows; drop them and re-render so the counts are exact.
deleteSeedRows();
await gotoAndWait();

async function gotoAndWait() {
  await page.goto(PAGE_URL);
  await page.waitForLoadState("domcontentloaded");
  // The label changed with ticket 56 (New answer → New Answer); the regex
  // keeps the before mode usable against older builds.
  await page.getByRole("link", { name: /new answer/i }).waitFor({ timeout: 10000 });
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
  await shotAt(360, 800, "before-answers-360");
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
const newAnswer = page.getByRole("link", { name: /new answer/i });
if (!(await newAnswer.isVisible())) {
  throw new Error("the New Answer button is missing");
}
const newClass = await newAnswer.getAttribute("class");
if (!newClass || !newClass.includes("primaryButton")) {
  throw new Error(`New Answer must be the filled primary button, found: ${newClass}`);
}
const newLabel = (await newAnswer.innerText()).trim();
if (!newLabel.includes("New Answer")) {
  throw new Error(`the button must read New Answer, found: ${newLabel}`);
}
console.log("ok: three tabs with Answer Rules default; New Answer is the filled primary action");

// Cards render collapsed with the six seeded topics visible.
const cards = page.locator('[class*="answersList"] > li');
const cardCount = await cards.count();
if (cardCount !== 6) {
  throw new Error(`expected 6 answer cards, found ${cardCount}`);
}
const firstToggle = cards.first().getByRole("button", { expanded: false }).first();
if ((await firstToggle.getAttribute("aria-expanded")) !== "false") {
  throw new Error("cards must start collapsed");
}
// Collapsed cards show the phrase count and a decorative icon tile.
if (!(await cards.first().innerText()).match(/\d+ phrase/)) {
  throw new Error("a collapsed card does not show its phrase count");
}
const tileSvg = cards.first().locator('[class*="answersCardTile"] svg');
if ((await tileSvg.count()) !== 1) {
  throw new Error("a collapsed card is missing its icon tile");
}
// The map is deterministic: Scholarships (graduation cap) and Fees (coins)
// must carry different marks. Card text leaks across rows (the Admissions
// response mentions fees), so every pick is pinned to its own card's topic
// row via .first() on hasText filters.
const tileMark = (card) => card.first().locator('[class*="answersCardTile"] svg').innerHTML();
const scholarshipsCard = cards.filter({ hasText: "Scholarships" }).first();
const feesCard = cards.filter({ hasText: "Fees" }).first();
// The Fees seed carries keywords and a link, so the funnel and chain-link
// meta icons render for real (the mockup's collapsed meta row).
const feesMeta = feesCard.locator('[class*="answersCardMeta"]').first();
const feesMetaText = await feesMeta.innerText();
for (const expected of ["2 keyword conditions", "College page link"]) {
  if (!feesMetaText.includes(expected)) {
    throw new Error(`the Fees collapsed meta is missing "${expected}": ${feesMetaText}`);
  }
}
if ((await feesMeta.locator("svg").count()) < 3) {
  throw new Error("the Fees collapsed meta is missing its iconified items");
}
if ((await tileMark(scholarshipsCard)) === (await tileMark(feesCard))) {
  throw new Error("Scholarships and Fees must map to different topic icons");
}
console.log("ok: every card carries a deterministic icon tile");

// Collapsed previews truncate on one line (ticket 56's mockup treatment).
const previewLine = await cards
  .filter({ hasText: "Admissions" })
  .first()
  .locator('[class*="answersCardPreview"]')
  .evaluate((el) => {
    const style = getComputedStyle(el);
    return { whiteSpace: style.whiteSpace, truncated: el.scrollWidth > el.clientWidth };
  });
if (previewLine.whiteSpace !== "nowrap" || !previewLine.truncated) {
  throw new Error(
    `the long preview must truncate on one line, found white-space=${previewLine.whiteSpace} truncated=${previewLine.truncated}`,
  );
}
console.log("ok: collapsed previews truncate with a single-line ellipsis");

// Badges: published cards show the title-case pill with its check mark; the
// draft card keeps visible neutral text and no check.
const publishedBadge = scholarshipsCard.locator('[class*="publishedBadge"]');
if (!(await publishedBadge.innerText()).includes("Published")) {
  throw new Error("the published badge must read Published");
}
if ((await publishedBadge.locator("svg").count()) !== 1) {
  throw new Error("the published badge is missing its check mark");
}
const draftCard = cards.filter({ hasText: "Transcript requests" }).first();
const draftBadge = draftCard.locator('[class*="draftBadge"]');
if (!(await draftBadge.innerText()).includes("Draft")) {
  throw new Error("the draft badge must read Draft");
}
if ((await draftCard.locator('[class*="publishedBadge"]').count()) !== 0) {
  throw new Error("a draft card must not show the published pill");
}
console.log("ok: check-marked Published pills; visible-text Draft badge");

// Expanding reveals the full response and the divider foot: review trail,
// phrase count, and the compact Edit action right-aligned on that row. The
// collapsed meta row stands down while open.
const scholarToggle = scholarshipsCard.getByRole("button", { expanded: false }).first();
await scholarToggle.click();
const expandedPanel = scholarshipsCard.locator('[class*="answersCardBody"]').first();
await expandedPanel.waitFor({ timeout: 5000 });
const foot = scholarshipsCard.locator('[class*="answersCardFoot"]');
const footText = await foot.innerText();
for (const expected of ["Published by", "Reviewed", "phrase"]) {
  if (!footText.includes(expected)) {
    throw new Error(`the expanded foot is missing "${expected}": ${footText}`);
  }
}
const footDivider = await foot.evaluate((el) => getComputedStyle(el).borderTopWidth);
if (footDivider === "0px") {
  throw new Error("the expanded card is missing its divider");
}
const collapsedMetaHidden = await scholarshipsCard
  .locator('[class*="answersCardToggle"] [class*="answersCardMeta"]')
  .evaluate((el) => getComputedStyle(el).display === "none");
if (!collapsedMetaHidden) {
  throw new Error("the collapsed meta row must stand down while the card is open");
}
const editLink = foot.getByRole("link", { name: "Edit" });
if (!(await editLink.isVisible())) {
  throw new Error("the expanded card does not expose an Edit action");
}
const editHref = await editLink.getAttribute("href");
if (!editHref || !editHref.match(/\/dashboard\/answers\/[0-9a-f-]{36}$/)) {
  throw new Error(`the Edit action does not target the editor: ${editHref}`);
}
console.log("ok: cards expand to the divider foot with publisher/reviewed/phrases and Edit");

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

// The toolbar: search with its magnifier and mockup placeholder, the status
// filter, and the count/order line under the row.
const search = page.getByRole("searchbox");
if ((await search.getAttribute("placeholder")) !== "Search answers…") {
  throw new Error("the search placeholder does not match the mockup");
}
if ((await page.locator('[class*="answersSearchWrap"] svg').count()) !== 1) {
  throw new Error("the search box is missing its magnifying-glass icon");
}
const statusFilter = page.getByRole("combobox", { name: "Filter by status" });
if ((await statusFilter.inputValue()) !== "all") {
  throw new Error("the status filter must default to All statuses");
}
// The count <p> only: [class*=answersCount] also matches answersCountRow.
const countLine = page.locator('p[class*="answersCount"]');
const sortNote = page.locator('[class*="answersSortNote"]');
if ((await countLine.innerText()).trim() !== "6 answers") {
  throw new Error(`the count line must read 6 answers, found: ${await countLine.innerText()}`);
}
if (!(await sortNote.innerText()).includes("Sorted by current order")) {
  throw new Error("the informational order note is missing");
}
console.log("ok: toolbar with search icon, placeholder, count line, and order note");

// Search filters live, case-insensitively, with an empty state.
await search.fill("SCHOLAR");
await page.waitForTimeout(200);
if ((await cards.count()) !== 1 || !(await cards.first().innerText()).includes("Scholarships")) {
  throw new Error(`case-insensitive search did not isolate Scholarships (found ${await cards.count()})`);
}
if ((await countLine.innerText()).trim() !== "1 answer") {
  throw new Error("the live count does not follow the search");
}
// The status filter composes with the text query (AND), client-side.
await search.fill("");
await statusFilter.selectOption("published");
await page.waitForTimeout(200);
if ((await cards.count()) !== 5) {
  throw new Error(`the published filter must keep 5 cards (found ${await cards.count()})`);
}
if ((await countLine.innerText()).trim() !== "5 answers") {
  throw new Error(`the count must follow the status filter, found: ${await countLine.innerText()}`);
}
await statusFilter.selectOption("draft");
await page.waitForTimeout(200);
if ((await cards.count()) !== 1 || !(await cards.first().innerText()).includes("Transcript requests")) {
  throw new Error("the draft filter must isolate the draft rule");
}
// AND: the draft rule does not match the scholar query, so nothing is left.
await search.fill("scholar");
await page.waitForTimeout(200);
if ((await cards.count()) !== 0 || !(await page.getByText("No answers match").count())) {
  throw new Error("search and status must compose with AND into the empty state");
}
// Reset both, restoring the full list.
await search.fill("");
await statusFilter.selectOption("all");
await page.waitForTimeout(200);
if ((await cards.count()) !== 6) {
  throw new Error("clearing both filters does not restore every card");
}
console.log("ok: live search + status filter composing AND with a live count");

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
