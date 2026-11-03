// Ticket 18 + 38 verification + screenshots (headless Chromium, one-off).
// Opens the widget on the demo page against a scratch database, flips the
// published-topic set by direct SQL while the server runs (many → one →
// none), and exercises click-through, handoff state, the self-dismissing
// email-declined note, transcript dominance, long transcript, and three
// viewport widths. Usage: node scripts/topics-shots.mjs <outdir> [port]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import process from "node:process";

const OUT = process.argv[2] ?? ".scratch/college-website-chat/references/shots-after";
const BASE = `http://127.0.0.1:${process.argv[3] ?? "3124"}`;
const DB_PATH = process.env.CHATBOT_DB ?? ".scratch/college-website-chat/topics-demo.db";

for (let attempt = 0; ; attempt++) {
  try {
    await fetch(`${BASE}/api/healthz`);
    break;
  } catch {
    if (attempt > 40) throw new Error("server never came up");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** Extra published topics beyond the seeds; one label wraps two lines. The
    first phrase doubles as the question the chip sends (as with seeds). */
const EXTRA_TOPICS = [
  ["Courses and programs", "Courses answer for the screenshot seed.", ["What courses and programs do you offer", "courses programs"]],
  ["Campus tours", "Campus tour answer for the screenshot seed.", ["When do campus tours run", "campus tour"]],
  ["How do I apply for financial aid and bursaries as a part-time student?", "Part-time financial aid answer for the screenshot seed.", ["How do I apply for financial aid", "part time bursaries"]],
  ["Opening hours", "Opening hours answer for the screenshot seed.", ["What are the opening hours", "opening hours"]],
  ["Parking on campus", "Parking answer for the screenshot seed.", ["Where can visitors park", "visitor parking"]],
];

function db() {
  return new DatabaseSync(DB_PATH);
}

async function seedExtraTopics() {
  const conn = db();
  const now = new Date().toISOString();
  // Idempotent: drop this script's previous extras before re-inserting.
  const placeholders = EXTRA_TOPICS.map(() => "?").join(", ");
  conn.prepare(`DELETE FROM answer_rules WHERE topic IN (${placeholders})`).run(...EXTRA_TOPICS.map(([topic]) => topic));
  const insert = conn.prepare(
    "INSERT INTO answer_rules (id, topic, response, link, phrases, keywords, status, updated_at, published_by, reviewed_at) VALUES (?, ?, ?, NULL, ?, NULL, 'published', ?, NULL, ?)",
  );
  for (const [topic, response, phrases] of EXTRA_TOPICS) {
    insert.run(crypto.randomUUID(), topic, response, JSON.stringify(phrases), now, now);
  }
  conn.close();
}

async function keepOnlyOneTopic() {
  const conn = db();
  const keep = conn.prepare("SELECT id FROM answer_rules WHERE status = 'published' ORDER BY topic LIMIT 1").get().id;
  conn.prepare("DELETE FROM answer_rules WHERE id <> ?").run(keep);
  conn.close();
}

async function deleteAllTopics() {
  const conn = db();
  conn.prepare("DELETE FROM answer_rules").run();
  conn.close();
}

// Any chatbot route initializes the service singleton (migrations + seed
// rules); healthz alone does not.
const topicsResponse = await fetch(`${BASE}/api/v1/topics`);
if (!topicsResponse.ok) throw new Error(`topics fetch failed: ${topicsResponse.status}`);
console.log("service ready; seeded topics:", ((await topicsResponse.json()).topics).length);

await seedExtraTopics();

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
mkdirSync(OUT, { recursive: true });

const frame = page.frameLocator(".sfcw-frame");

async function openWidget(width, height) {
  await page.setViewportSize({ width, height });
  await page.goto(`${BASE}/demo/wordpress-test-page.html`);
  await page.waitForLoadState("domcontentloaded");
  await page.locator(".sfcw-launcher").click();
  await frame.locator('textarea[placeholder="Type your question"]').waitFor({ timeout: 10000 });
  await frame.locator('[aria-label="Suggested questions"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(600);
}

async function shot(name) {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
  console.log("captured", name);
}

async function waitForSendReady() {
  const send = frame.getByRole("button", { name: "Send" });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await send.isEnabled()) return;
    await page.waitForTimeout(250);
  }
  throw new Error("message send never completed");
}

async function assertMenuWithinFrame(label) {
  const panel = await frame.getByRole("menu").boundingBox();
  const widget = await page.locator(".sfcw-frame").boundingBox();
  if (!panel || !widget || panel.x < widget.x || panel.x + panel.width > widget.x + widget.width) {
    throw new Error(`conversation menu clips at ${label}`);
  }
}

// --- Desktop: mixed one/two-line chips in horizontal overflow. ------------
await openWidget(1280, 800);
const strip = frame.locator('[aria-label="Suggested questions"]');
const chips = strip.locator("button");
console.log("chips rendered:", await chips.count());
const overflow = await strip.evaluate((el) => ({
  scrollWidth: el.scrollWidth,
  clientWidth: el.clientWidth,
}));
console.log("strip overflow:", JSON.stringify(overflow));
if (overflow.clientWidth >= overflow.scrollWidth) throw new Error("strip does not overflow");

const shortChip = chips.filter({ hasText: "Admissions" });
const longChip = chips.filter({ hasText: "How do I apply for financial aid" });
const mixedLayout = await Promise.all([shortChip, longChip].map((chip) => chip.evaluate((button) => {
  const label = button.querySelector("span");
  const labelStyle = getComputedStyle(label);
  const buttonRect = button.getBoundingClientRect();
  return {
    top: buttonRect.top,
    height: buttonRect.height,
    lines: Math.round(label.getBoundingClientRect().height / Number.parseFloat(labelStyle.lineHeight)),
  };
})));
console.log("mixed chip layout:", JSON.stringify(mixedLayout));
if (Math.abs(mixedLayout[0].top - mixedLayout[1].top) > 2) {
  throw new Error("short and long chips are stacked instead of flowing left-to-right");
}
if (mixedLayout[0].lines !== 1 || mixedLayout[1].lines !== 2) {
  throw new Error(`expected one-line and two-line chips, got ${mixedLayout[0].lines}/${mixedLayout[1].lines}`);
}
if (mixedLayout[1].height <= mixedLayout[0].height) {
  throw new Error("long chip did not grow independently of the short chip");
}
await shot("after-widget-topics-desktop");

// At the resting position the trailing fade hints at more; scrolling to the
// end turns the end fade off and the start fade on.
const fadeEnd = frame.locator('[class*="fadeEnd"]');
const fadeStart = frame.locator('[class*="fadeStart"]');
await strip.evaluate((el) => {
  el.scrollLeft = 0;
});
await page.waitForTimeout(300);
if (!(await fadeEnd.getAttribute("class")).includes("fadeOn")) throw new Error("end fade missing at scroll start");
await strip.evaluate((el) => {
  el.scrollLeft = el.scrollWidth;
});
await page.waitForTimeout(400);
const endFadeOff = !(await fadeEnd.getAttribute("class")).includes("fadeOn");
const startFadeOn = (await fadeStart.getAttribute("class")).includes("fadeOn");
console.log("fades at scroll end: end off =", endFadeOff, ", start on =", startFadeOn);
if (!endFadeOff || !startFadeOn) throw new Error("edge fades did not track the scroll position");

// A picked chip follows the existing topic flow: the chip's question text
// lands in the transcript once.
const picked = "What are the admission requirements";
await chips.filter({ hasText: "Admissions" }).click();
await page.waitForTimeout(1500);
console.log(
  "transcript after chip click:",
  JSON.stringify((await frame.locator('[role="log"]').innerText()).slice(0, 300)),
);
await frame.locator('[role="log"]').getByText(picked).waitFor({ timeout: 10000 });
await waitForSendReady();
console.log("picked chip question reached the transcript");

// Ticket 39: Clear conversation lives in the header menu. Exercise the real
// focus/Escape layers, successor-session swap, transcript reset, and retained
// history before continuing the screenshot journey in the fresh chat.
const oldSession = await frame.locator("body").evaluate(() =>
  JSON.parse(sessionStorage.getItem("sfc_chatbot_v1_session")),
);
const menuButton = frame.getByRole("button", { name: "Conversation options" });
await menuButton.click();
const clearItem = frame.getByRole("menuitem", { name: "Clear conversation" });
if (!(await clearItem.evaluate((button) => document.activeElement === button))) {
  throw new Error("opening the conversation menu did not focus its item");
}
await clearItem.press("Escape");
if (!(await menuButton.evaluate((button) => document.activeElement === button))) {
  throw new Error("Escape did not close the menu and return focus to its button");
}
await menuButton.click();
await clearItem.click();
const clearChat = frame.getByRole("button", { name: "Clear chat" });
if (!(await clearChat.evaluate((button) => document.activeElement === button))) {
  throw new Error("clear confirmation did not receive focus");
}
await clearChat.press("Escape");
if (!(await menuButton.evaluate((button) => document.activeElement === button))) {
  throw new Error("Escape did not cancel confirmation and return focus");
}
await menuButton.click();
await clearItem.click();
await clearChat.click();
await frame.locator('[role="log"]').getByText(picked).waitFor({ state: "detached" });
const newSession = await frame.locator("body").evaluate(() =>
  JSON.parse(sessionStorage.getItem("sfc_chatbot_v1_session")),
);
if (!oldSession?.id || oldSession.id === newSession?.id) {
  throw new Error("clear did not swap to a fresh successor conversation");
}
const retained = await fetch(`${BASE}/api/v1/conversations/${oldSession.id}/messages`, {
  headers: { Authorization: `Bearer ${oldSession.token}` },
});
if (!retained.ok || !JSON.stringify(await retained.json()).includes(picked)) {
  throw new Error("cleared visitor transcript was not retained for staff");
}
console.log("header menu clear flow reset the visitor and retained staff history");

// An explicit handoff phrase escalates; the notice appears and the intro
// line does not (ticket 38: chips are the affordance, the notice the state).
await frame.locator("textarea").fill("I need to speak to a human");
await frame.locator("textarea").press("Enter");
await frame.locator("text=Automated answers are paused").waitFor({ timeout: 10000 });
if ((await frame.getByText("Pick a topic").count()) !== 0) {
  throw new Error("intro line should be gone while topic chips are visible (ticket 38)");
}
await chips.filter({ hasText: "Opening hours" }).click();
await frame
  .locator('[role="log"]')
  .getByText("What are the opening hours", { exact: false })
  .waitFor({ timeout: 10000 });
await waitForSendReady();
console.log("chip during takeover sent to staff without a bot reply");
await shot("after-widget-topics-handoff");

// Ticket 38: the transcript is the widget's dominant region, and the
// declined-email note dismisses itself after ten seconds.
async function transcriptShare() {
  const panel = await frame.locator("main").boundingBox();
  const log = await frame.locator('[role="log"]').boundingBox();
  if (!panel || !log) throw new Error("could not measure transcript share");
  return log.height / panel.height;
}
console.log("transcript share with full handoff chrome:", (await transcriptShare()).toFixed(3));
// Full handoff state + long transcript must leave every control visible at
// once: composer and strip stay inside the panel, nothing clips (ticket 38).
const panelBox = await frame.locator("main").boundingBox();
for (const region of ['[role="log"]', '[aria-label="Suggested questions"]', 'form[class$="_form"]']) {
  const box = await frame.locator(region).boundingBox();
  if (!panelBox || !box || box.y + box.height > panelBox.y + panelBox.height + 1) {
    throw new Error(`full handoff state clips ${region}`);
  }
}
await frame.getByText("No thanks").click();
await frame.getByText("No email saved").waitFor({ timeout: 5000 });
await shot("after-widget-topics-email-declined");
await page.waitForTimeout(10_800);
if ((await frame.getByText("No email saved").count()) !== 0) {
  throw new Error("declined note did not dismiss itself after ~10s (ticket 38)");
}
const share = await transcriptShare();
console.log("transcript share after note dismissal:", share.toFixed(3));
if (share < 0.45) {
  throw new Error(`transcript is not dominant after the note leaves: ${(share * 100).toFixed(1)}%`);
}
await shot("after-widget-topics-note-dismissed");

// A long transcript keeps the strip pinned above the composer.
for (const text of ["Screenshot seed follow-up one", "Screenshot seed follow-up two", "Screenshot seed follow-up three makes this transcript long"]) {
  await frame.locator("textarea").fill(text);
  await frame.locator("textarea").press("Enter");
  await frame.locator('[role="log"]').getByText(text).waitFor({ timeout: 10000 });
  await waitForSendReady();
}
await shot("after-widget-topics-long-transcript");
// The note shows once per declined handoff: later messages never bring it
// back (ticket 38).
if ((await frame.getByText("No email saved").count()) !== 0) {
  throw new Error("declined note returned after subsequent messages");
}

// Pending-send (ticket 18): while a message POST is in flight — delayed
// here — every chip disables, so a second click cannot duplicate the send.
const MESSAGES_URL = /\/api\/v1\/conversations\/[a-f0-9-]+\/messages$/;
await page.route(MESSAGES_URL, async (route) => {
  await new Promise((resolve) => setTimeout(resolve, 1200));
  // Unrouting mid-flight marks the held route handled; a stale continue is
  // harmless then.
  await route.continue().catch(() => {});
});
await chips.filter({ hasText: "Parking" }).click();
await page.waitForTimeout(300);
const disabledChips = await strip.locator("button:disabled").count();
const chipCount = await chips.count();
console.log("disabled chips while pending:", disabledChips, "of", chipCount);
if (disabledChips !== chipCount) throw new Error("chips not all disabled while a send is pending");
await page.unroute(MESSAGES_URL);
await frame
  .locator('[role="log"]')
  .getByText("Where can visitors park", { exact: false })
  .waitFor({ timeout: 10000 });
console.log("pending chip message landed exactly once");

// --- Narrow widths. -------------------------------------------------------
await openWidget(390, 760);
await frame.getByRole("button", { name: "Conversation options" }).click();
await assertMenuWithinFrame("phone width");
await shot("after-widget-topics-phone");
await frame.getByRole("menuitem", { name: "Clear conversation" }).press("Escape");
await openWidget(360, 740);
await frame.getByRole("button", { name: "Conversation options" }).click();
await assertMenuWithinFrame("360px");
const narrow = await strip.evaluate((el) => ({
  clientWidth: el.clientWidth,
  composerWidth: el.parentElement.clientWidth,
}));
console.log("360px strip:", JSON.stringify(narrow));
await shot("after-widget-topics-360");

// --- One topic, then none. ------------------------------------------------
// A page reload recreates the frame (and refetches topics, per the
// widget's every-open behavior); the launcher needs clicking again.
async function reopenAfterTopicsChange() {
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.locator(".sfcw-launcher").click();
  await frame.locator('textarea[placeholder="Type your question"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(600);
}

await keepOnlyOneTopic();
await reopenAfterTopicsChange();
console.log("one topic chips:", await frame.locator('[aria-label="Suggested questions"] button').count());
await shot("after-widget-topics-one");

await deleteAllTopics();
await reopenAfterTopicsChange();
await page.waitForTimeout(800);
const stripCount = await frame.locator('[aria-label="Suggested questions"]').count();
console.log("strip hidden with no topics:", stripCount === 0);
if (stripCount !== 0) throw new Error("strip should hide when no topics are published");
await shot("after-widget-topics-none");

await browser.close();
console.log("DONE", OUT);
