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
  // The accessible name reads "Sending…" while the request runs (ticket 42),
  // so the locator matches the verb stem rather than the resting label.
  const send = frame.getByRole("button", { name: /Send/ });
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

// --- Fresh state (ticket 46): the reference-led start layout. --------------
await openWidget(1280, 800);
// The first open is a genuinely fresh chat (no stored session): the
// greeting (ticket 41) leads the transcript as a composed row.
await frame.getByText("Hi! How can I help you today?").waitFor({ timeout: 10000 });
console.log("fresh open greets the visitor");
// The greeting is presentation-only: opening the widget must not have
// minted a conversation or visitor credential (ticket 41).
if (
  await frame
    .locator("body")
    .evaluate(() => sessionStorage.getItem("sfc_chatbot_v1_session") !== null)
) {
  throw new Error("the fresh open minted a visitor credential; the greeting must not");
}
// The reference hierarchy: the greeting row carries its crest avatar and a
// local timestamp, then suggestions stack toward the visitor.
if ((await frame.locator('[aria-label="Messages"] time').count()) !== 1) {
  throw new Error("the fresh greeting lacks its timestamp");
}
const fresh = frame.locator('[aria-label="Suggested questions"]');
const freshButtons = fresh.locator("button");
const freshCount = await freshButtons.count();
console.log("fresh suggestions rendered:", freshCount);
if (freshCount < 4) {
  throw new Error(`expected the seeded suggestions stacked, got ${freshCount}`);
}
const freshGroup = await fresh.boundingBox();
const freshBoxes = await Promise.all(
  Array.from({ length: freshCount }, (_, index) => freshButtons.nth(index).boundingBox()),
);
if (!freshGroup) throw new Error("fresh suggestions group has no box");
for (let index = 1; index < freshBoxes.length; index += 1) {
  if (freshBoxes[index].top <= freshBoxes[index - 1].top) {
    throw new Error("fresh suggestions are not stacked vertically");
  }
}
for (const box of freshBoxes) {
  // The reference stacks the pills flush with each other on the right (the
  // group's own padding is not part of the alignment).
  const rightGap = Math.abs(
    freshBoxes[0].x + freshBoxes[0].width - (box.x + box.width),
  );
  if (rightGap > 2) {
    throw new Error(`fresh suggestions are not right-aligned (gap ${rightGap}px)`);
  }
  if (box.x + box.width < freshGroup.x + freshGroup.width / 2) {
    throw new Error("fresh suggestions do not lean toward the visitor side");
  }
}
console.log("ok: fresh suggestions stack right-aligned like the reference");
await shot("after-widget-fresh-desktop");

// Narrow embed: long labels wrap, nothing scrolls the page sideways.
await page.setViewportSize({ width: 360, height: 720 });
await page.waitForTimeout(400);
const freshOverflow = await fresh.evaluate((el) => ({
  scrollWidth: el.scrollWidth,
  clientWidth: el.clientWidth,
}));
if (freshOverflow.scrollWidth > freshOverflow.clientWidth + 1) {
  throw new Error("fresh suggestions force horizontal scrolling at 360px");
}
await shot("after-widget-fresh-360");
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(400);

// A picked suggestion follows the existing topic flow: the question text
// lands in the transcript once, and the layout flips to the conversation
// view (ticket 46).
const picked = "What are the admission requirements";
await freshButtons.filter({ hasText: "Admissions" }).click();
await page.waitForTimeout(1500);
console.log(
  "transcript after suggestion click:",
  JSON.stringify((await frame.locator('[role="log"]').innerText()).slice(0, 300)),
);
await frame.locator('[role="log"]').getByText(picked).waitFor({ timeout: 10000 });
await waitForSendReady();
console.log("picked suggestion question reached the transcript");

// --- The compact strip (ticket 18) takes over for the conversation. -------
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
// Smooth scrolling (ticket 18) animates the assignment; give it a generous
// budget so the check reads the resting position, not the animation.
await page.waitForTimeout(700);
const endFadeOff = !(await fadeEnd.getAttribute("class")).includes("fadeOn");
const startFadeOn = (await fadeStart.getAttribute("class")).includes("fadeOn");
console.log("fades at scroll end: end off =", endFadeOff, ", start on =", startFadeOn);
if (!endFadeOff || !startFadeOn) throw new Error("edge fades did not track the scroll position");

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
// The clear revokes the old visitor credential immediately (the glossary's
// Clear-conversation contract, ticket 14), so the old transcript is checked
// here only through that revocation: the credential that worked seconds ago
// must now be dead. That staff history itself survives is proven by
// tests/conversation-clear.test.ts at the API seam.
const revoked = await fetch(`${BASE}/api/v1/conversations/${oldSession.id}/messages`, {
  headers: { Authorization: `Bearer ${oldSession.token}` },
});
// A dead credential must unlock nothing: 401 outright, or the deliberate
// 404 the API returns for unknown credentials so conversation existence
// never leaks (the widget drops its session on either).
if (revoked.status !== 401 && revoked.status !== 404) {
  throw new Error(`cleared conversation's old credential still works (${revoked.status})`);
}
console.log("header menu clear flow reset the visitor and revoked the old credential");

// A long transcript keeps the strip pinned above the composer. This runs
// before the handoff section: once staff help is requested the composer
// locks (ticket 43), so all free typing happens while the chat is bot-active.
for (const text of ["Screenshot seed follow-up one", "Screenshot seed follow-up two", "Screenshot seed follow-up three makes this transcript long"]) {
  await frame.locator("textarea").fill(text);
  await frame.locator("textarea").press("Enter");
  await frame.locator('[role="log"]').getByText(text).waitFor({ timeout: 10000 });
  await waitForSendReady();
}
await shot("after-widget-topics-long-transcript");

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
// Ticket 42: the composer's send names its active verb while the request
// is held in flight here.
const sendLabel = await frame.locator('form[class$="_form"] button').textContent();
if (!sendLabel.includes("Sending…")) {
  throw new Error(`send button did not show its pending verb: ${sendLabel}`);
}
console.log("send button shows Sending… while pending");
await page.unroute(MESSAGES_URL);
await frame
  .locator('[role="log"]')
  .getByText("Where can visitors park", { exact: false })
  .waitFor({ timeout: 10000 });
console.log("pending chip message landed exactly once");

// An explicit handoff phrase escalates; the notice appears and the intro
// line does not (ticket 38: chips are the affordance, the notice the state).
// This is the journey's last interactive section: from here the composer
// locks (ticket 43), so nothing after it types.
await frame.locator("textarea").fill("I need to speak to a human");
await frame.locator("textarea").press("Enter");
await frame.locator("text=Automated answers are paused").waitFor({ timeout: 10000 });
if ((await frame.getByText("Pick a topic").count()) !== 0) {
  throw new Error("intro line should be gone while topic chips are visible (ticket 38)");
}
// Ticket 43: the composer locks while staff help is requested but
// unclaimed — the textarea disables, the waiting line explains, and the
// chips lock with it (superseding ticket 18's send-to-staff-during-takeover
// behavior for the waiting period).
await frame.getByText("Waiting for a staff member to take over…").waitFor({ timeout: 10000 });
if (!(await frame.locator('form[class$="_form"] textarea').isDisabled())) {
  throw new Error("composer did not lock while waiting for staff (ticket 43)");
}
const waitingChips = await strip.locator("button").count();
if ((await strip.locator("button:disabled").count()) !== waitingChips) {
  throw new Error("chips not locked while waiting for staff (ticket 43)");
}
console.log("composer and chips locked while waiting for staff");
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
  // These reopens resume the existing conversation, so the fresh-chat
  // greeting (ticket 41) must not appear above the restored history.
  const greetings = await frame.getByText("Hi! How can I help you today?").count();
  if (greetings !== 0) throw new Error("resumed conversation must not greet again");
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
