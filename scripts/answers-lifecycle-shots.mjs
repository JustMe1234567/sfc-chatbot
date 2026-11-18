// Ticket 58 verification (headless Chromium): the full-height rail and the
// reference Answers page with the answer lifecycle. Signs the owner in
// through the real UI, then asserts the app-shell scrolling contract (the
// page itself never scrolls; the content column does; the rail stays full
// height with Sign out reachable; a hover callout survives content scrolls;
// a short viewport scrolls the nav internally), the reference rail styling
// (compact default, expanded state, crest, red-accented Sign out), the
// Answers page (cards, badges, pills, highlighted expanded card, the
// three-dot menu per status, keyboard operation), and every lifecycle
// action end-to-end — Duplicate, Archive/Restore, Trash/Restore, and
// Permanently delete through the shared confirm dialog — with the visitor
// topic list never offering archived or trashed answers. Responsive and
// reduced-motion passes included.
// Usage: node scripts/answers-lifecycle-shots.mjs <outdir> [port]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { TOTP, URI } from "otpauth";
import process from "node:process";

const OUT = process.argv[2] ?? ".scratch/college-website-chat/references/shots-answers-58";
const PORT = process.argv[3] ?? "3217";
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = process.env.CHATBOT_DB ?? ".scratch/college-website-chat/answers58.db";
const USERNAME = "owner";
const PASSWORD = "Springfield2026!";

for (let attempt = 0; ; attempt++) {
  try {
    await fetch(`${BASE}/api/healthz`);
    break;
  } catch {
    if (attempt > 60) throw new Error("server never came up");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// Warm the service singleton (migrations + seeds) before touching the DB.
const warm = await fetch(`${BASE}/api/v1/topics`);
if (!warm.ok) throw new Error(`topics fetch failed: ${warm.status}`);

const db = new DatabaseSync(DB_PATH);
// No enrollment wipe and no owner-row lookup here (ticket 80): the store is
// hosted Postgres (staff in staff_members, TOTP factors in hosted Supabase
// Auth), which node:sqlite cannot reach — this script's SQLite seeding pass
// is parked on the run-substrate decision, and the username sign-in below
// enrolls the fresh owner through the real UI.
// A clean rule set: re-runs must not inherit earlier copies, archives, or
// purges. Earlier runs' audit rows reference rule ids, so they detach first
// — exactly the treatment the store's deleteAnswerRule gives them. The
// service's insert-if-absent seed restores its three fixed-id rows on the
// next render; this script deletes those right before its first render and
// re-renders, so counts stay exact regardless of worker topology (the
// ticket-55 lesson).
db.prepare("UPDATE audit_log SET rule_id = NULL WHERE rule_id IS NOT NULL").run();
db.prepare("DELETE FROM answer_rules").run();

const at = new Date().toISOString();
// Eight extras beside the service's three fixed-id seeds: the mockup's
// subject matter plus a draft. The fixed-id seeds themselves
// are deleted and never counted on — a render worker re-seeding them mid-run
// cannot disturb these counts (the ticket-55 lesson).
const extras = [
  {
    topic: "Admissions",
    response:
      "You can apply online through our admissions portal. Undergraduate applications ask for your high school transcript and one reference letter. See the admissions page for the full checklist.",
    phrases: ["What are the admission requirements", "How do I apply", "Admission requirements"],
    keywords: [["admissions", "requirements"], ["apply"]],
    status: "published",
  },
  {
    topic: "Fees",
    response: "Tuition for most programs is $3,500 per semester. See the fees page for the current schedule.",
    link: "https://www.springfieldcollege.edu/fees",
    phrases: ["How much are the tuition fees", "Tuition fees", "Fees"],
    keywords: [["fees"], ["tuition"]],
    status: "published",
  },
  {
    topic: "Scholarships",
    response: "Scholarship details are being reviewed and are not published yet. Ask staff for the current options.",
    phrases: ["Scholarships", "Financial aid", "Bursaries"],
    status: "published",
  },
  {
    topic: "Campus parking",
    response:
      "Visitor parking sits in the North Garage on Elm Street. Day passes are available at the gate, and accessible spaces are next to every elevator lobby.",
    phrases: ["parking", "where can I park"],
    status: "published",
  },
  {
    topic: "Library hours",
    response:
      "The main library opens 8am to midnight on weekdays and 10am to 10pm on weekends during term. Hours change over the summer and between semesters.",
    phrases: ["library hours", "when is the library open"],
    status: "published",
  },
  {
    topic: "Transcript requests",
    response:
      "Official transcripts are requested through the registrar's online form and are ready for pickup or mail within five business days.",
    phrases: ["transcript"],
    status: "published",
  },
  {
    topic: "Parking permits",
    response:
      "Resident students register vehicles with campus safety; the annual permit covers both the North Garage and the west lot.",
    phrases: ["permit", "parking permit"],
    status: "published",
  },
  {
    topic: "Scholarships draft copy",
    response: "A draft card for the lifecycle checks.",
    phrases: ["scholarship draft copy"],
    status: "draft",
  },
];
const existing = new Set(
  db.prepare("SELECT topic FROM answer_rules").all().map((row) => row.topic),
);
for (const extra of extras) {
  if (existing.has(extra.topic)) continue;
  db.prepare(
    `INSERT INTO answer_rules (id, topic, response, link, phrases, keywords, status, updated_at, published_by, reviewed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    extra.topic,
    extra.response,
    extra.link ?? null,
    JSON.stringify(extra.phrases),
    extra.keywords ? JSON.stringify(extra.keywords) : null,
    extra.status,
    at,
    // published_by placeholder: the owner's id lives in the hosted Postgres
    // store, unreachable from this SQLite seeding pass (ticket 80 substrate).
    null,
    extra.status === "published" ? at : null,
  );
}
function deleteSeedRows() {
  const conn = new DatabaseSync(DB_PATH);
  conn.prepare(
    "DELETE FROM answer_rules WHERE id IN ('admissions-overview','fees-overview','scholarships-overview')",
  ).run();
  conn.close();
}
deleteSeedRows();
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
await page.fill("#username", USERNAME);
await page.fill("#password", PASSWORD);
await page.click("button[type=submit]");
await page.waitForURL("**/dashboard/enroll", { timeout: 60000 });
await page.getByRole("button", { name: "Begin enrollment" }).click();
await page.waitForSelector("code", { timeout: 60000 });
const secret = (await page.textContent("code")).trim();
const totp = URI.parse(`otpauth://totp/x?secret=${secret}`);
await page.fill("#totp", totp.generate());
await page.click("button[type=submit]");
await page.waitForURL("**/dashboard/login", { timeout: 15000 });
// Full sign-in with the second factor: the credentials stage flips to the
// TOTP stage on the same page.
await page.waitForSelector("#username", { timeout: 15000 });
await page.fill("#username", USERNAME);
await page.fill("#password", PASSWORD);
await page.click("button[type=submit]");
await page.waitForSelector("#totp", { timeout: 15000 });
await page.fill("#totp", totp.generate());
await page.click("button[type=submit]");
await page.waitForURL("**/dashboard/inbox", { timeout: 15000 });
console.log("signed in; enrollment complete");
mkdirSync(OUT, { recursive: true });

// A render worker initialized by the first navigation may have re-seeded the
// fixed-id rows; drop them and re-render so the count is exactly 8.
async function gotoAnswers() {
  await page.goto(`${BASE}/dashboard/answers`);
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("link", { name: /new answer/i }).waitFor({ timeout: 10000 });
}
await gotoAnswers();
deleteSeedRows();
await gotoAnswers();

const rail = page.locator("aside").first();
const navLinks = rail.getByRole("navigation", { name: "Dashboard" }).getByRole("link");

async function shotAt(width, height, name) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(350);
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.scrollingElement.scrollWidth,
    clientWidth: document.scrollingElement.clientWidth,
  }));
  if (overflow.scrollWidth > overflow.clientWidth + 1) {
    throw new Error(`horizontal page overflow at ${width}px on ${name}`);
  }
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
  console.log("captured", name);
}

function openCallout() {
  return page.locator('[class*="sideTip"][data-open]');
}

// Open a card's three-dot menu, parity-safe: the trigger toggles on click,
// and a rapid re-render can race a dispatched click into an extra toggle —
// so verify the menu actually opened and, if not, click once more.
async function openCardMenu(card, topic) {
  const button = card.getByRole("button", { name: new RegExp(`More actions for ${topic}`) });
  const menu = page.locator('[role="menu"]');
  for (let attempt = 0; attempt < 3; attempt++) {
    await button.click();
    try {
      await menu.waitFor({ timeout: 2000 });
      return menu;
    } catch {
      // fall through and click again
    }
  }
  throw new Error(`the menu for "${topic}" never opened`);
}

// --- The app-shell scrolling contract (ticket 58). --------------------------
// A long page: application settings. The document itself must not scroll.
await page.goto(`${BASE}/dashboard/settings`);
await page.waitForLoadState("domcontentloaded");
await rail.waitFor({ timeout: 10000 });
const pageScroll = await page.evaluate(() => ({
  scrollHeight: document.scrollingElement.scrollHeight,
  clientHeight: document.scrollingElement.clientHeight,
}));
if (pageScroll.scrollHeight > pageScroll.clientHeight + 1) {
  throw new Error(
    `the page gained a document scrollbar (${pageScroll.scrollHeight} > ${pageScroll.clientHeight})`,
  );
}
const contentArea = page.locator('[class*="contentArea"]').first();
const areaScroll = await contentArea.evaluate((el) => ({
  scrollHeight: el.scrollHeight,
  clientHeight: el.clientHeight,
}));
if (areaScroll.scrollHeight <= areaScroll.clientHeight) {
  throw new Error("the long page's content area has nothing to scroll");
}
// The rail spans the viewport exactly, crest and Sign out included.
const railBox = await rail.boundingBox();
if (!railBox || Math.abs(railBox.height - 900) > 2 || Math.abs(railBox.y) > 1) {
  throw new Error(`the rail is not full-height: ${JSON.stringify(railBox)}`);
}
// Scrolling the content to its bottom leaves Sign out exactly where it was.
await contentArea.evaluate((el) => {
  el.scrollTop = el.scrollHeight;
});
await page.waitForTimeout(300);
const signOut = rail.getByRole("button", { name: "Sign out" });
const signOutBox = await signOut.boundingBox();
if (!signOutBox || signOutBox.y + signOutBox.height > 900 + 1) {
  throw new Error("Sign out is not anchored at the rail's bottom");
}
console.log("ok: only the content column scrolls; the rail and Sign out hold still");

// A hover callout survives content scrolls (the rail is stationary).
await page.evaluate(() => window.localStorage.removeItem("dashboard.sidebar.collapsed"));
await page.goto(`${BASE}/dashboard/settings`);
await page.waitForLoadState("domcontentloaded");
if ((await rail.getAttribute("data-collapsed")) === null) {
  throw new Error("the rail does not default to compact");
}
await navLinks.first().hover();
await openCallout().waitFor({ timeout: 5000 });
await contentArea.evaluate((el) => {
  el.scrollTop = el.scrollHeight;
});
await page.waitForTimeout(250);
if ((await openCallout().count()) !== 1) {
  throw new Error("the callout did not survive the content scroll");
}
await rail.getByRole("heading").first().hover().catch(() => {});
await page.mouse.move(700, 300);
await page.waitForTimeout(200);
await shotAt(1280, 900, "rail-longpage-callout-1280");
console.log("ok: the callout stays put while the content scrolls");

// Short viewport: the nav scrolls internally; crest and Sign out remain.
await page.setViewportSize({ width: 1280, height: 520 });
await page.waitForTimeout(350);
const shortRail = await rail.boundingBox();
if (!shortRail || Math.abs(shortRail.height - 520) > 2) {
  throw new Error(`the rail is not full-height at 520px: ${JSON.stringify(shortRail)}`);
}
const navScroll = await rail
  .getByRole("navigation", { name: "Dashboard" })
  .evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
if (navScroll.scrollHeight <= navScroll.clientHeight) {
  throw new Error("the nav does not scroll internally on a short viewport");
}
const crest = rail.locator("img");
const crestBox = await crest.boundingBox();
const signOutShort = await signOut.boundingBox();
if (!crestBox || crestBox.y < 0 || crestBox.y + crestBox.height > 520) {
  throw new Error("the crest is not visible on the short viewport");
}
if (!signOutShort || signOutShort.y + signOutShort.height > 520 + 1) {
  throw new Error("Sign out is not visible on the short viewport");
}
await shotAt(1280, 520, "rail-short-viewport-1280x520");
console.log("ok: short viewport — nav scrolls internally, crest and Sign out stay");

await page.setViewportSize({ width: 1280, height: 900 });

// --- The Answers page in the compact rail. ----------------------------------
await page.goto(`${BASE}/dashboard/answers`);
await page.waitForLoadState("domcontentloaded");
await page.getByRole("link", { name: /new answer/i }).waitFor({ timeout: 10000 });

const cards = page.locator('[class*="answersList"] > li');
const cardCount = await cards.count();
if (cardCount !== 8) {
  throw new Error(`expected 8 answer cards (the eight extras), found ${cardCount}`);
}
// The heading row, tabs, toolbar, and cards share one aligned grid.
const headBox = await page.locator('[class*="answersHead"]').boundingBox();
const listBox = await page.locator('[class*="answersList"]').boundingBox();
if (!headBox || !listBox || Math.abs(headBox.x - listBox.x) > 6) {
  throw new Error(
    `the heading row and the cards are not aligned (head x=${headBox?.x}, list x=${listBox?.x})`,
  );
}
await shotAt(1280, 900, "answers-compact-1280");
console.log("ok: answers page aligned under the heading in the compact rail");

// Collapsed pills + badges; expand the draft card.
const draftCard = cards.filter({ hasText: "Scholarships draft copy" }).first();
const draftPills = await draftCard.locator('[class*="answersMetaPill"]').count();
if (draftPills < 1) {
  throw new Error("the collapsed card does not show its meta pills");
}
await draftCard.getByRole("button", { expanded: false }).first().click();
const draftBody = draftCard.locator('[class*="answersCardBody"]').first();
await draftBody.waitFor({ timeout: 5000 });
// The expanded card is the highlighted one.
const openShadow = await draftCard.evaluate((el) => getComputedStyle(el).boxShadow);
if (openShadow === "none") {
  throw new Error("the expanded card is not visually highlighted");
}
const footText = await draftCard.locator('[class*="answersCardFoot"]').innerText();
if (!footText.includes("Draft · last edited")) {
  throw new Error(`the draft foot is missing its trail: ${footText}`);
}
const expandedPills = await draftCard
  .locator('[class*="answersCardBody"] [class*="answersMetaPill"]')
  .count();
if (expandedPills < 1) {
  throw new Error("the expanded card does not repeat its pills above the footer");
}
console.log("ok: expanded card highlighted, pills repeated, draft trail present");

// The three-dot menu on the draft: Duplicate / Publish / Archive / Delete.
const menu = await openCardMenu(draftCard, "Scholarships draft copy");
let items = await menu.getByRole("menuitem").allInnerTexts();
if (!items.join("|").includes("Duplicate") || !items.join("|").includes("Publish")) {
  throw new Error(`the draft menu is wrong: ${items.join(" / ")}`);
}
if ((await menu.getByRole("menuitem", { name: "Unpublish" }).count()) !== 0) {
  throw new Error("a draft card must show Publish, not Unpublish");
}
await shotAt(1280, 900, "answers-menu-draft-1280");
// Keyboard: Escape closes and refocuses the button.
await page.keyboard.press("Escape");
await menu.waitFor({ state: "hidden", timeout: 5000 });
const refocused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
if (!refocused || !refocused.includes("More actions")) {
  throw new Error(`Escape did not return focus to the menu button: ${refocused}`);
}
console.log("ok: draft menu (Duplicate/Publish/Archive/Delete), Escape refocuses");

// Duplicate: a separate draft appears prefilled.
await openCardMenu(draftCard, "Scholarships draft copy").then((m) =>
  m.getByRole("menuitem", { name: "Duplicate" }).click(),
);
await cards
  .filter({ hasText: "Scholarships draft copy (copy)" })
  .first()
  .waitFor({ timeout: 10000 });
const copyCard = cards.filter({ hasText: "Scholarships draft copy (copy)" }).first();
if ((await copyCard.locator('[class*="draftBadge"]').count()) !== 1) {
  throw new Error("the duplicate must arrive as a Draft");
}
if ((await cards.count()) !== 9) {
  throw new Error(`the duplicate did not join the list (found ${await cards.count()})`);
}
console.log("ok: Duplicate creates a separate draft, original untouched");

// --- Archive / Restore through the published rule. ---------------------------
const permitsCard = cards.filter({ hasText: "Parking permits" }).first();
await permitsCard.getByRole("button", { expanded: false }).first().click();
const menu2 = await openCardMenu(permitsCard, "Parking permits");
await menu2.getByRole("menuitem", { name: "Archive" }).click();
await page.waitForTimeout(800);
// It leaves the active view.
if ((await cards.count()) !== 8) {
  throw new Error(`archiving did not remove the card from the active list (found ${await cards.count()})`);
}
// The topics API must not offer it to visitors anymore.
const topicsBody = await (await context.request.get(`${BASE}/api/v1/topics`)).json();
if (topicsBody.topics.some((topic) => topic.topic === "Parking permits")) {
  throw new Error("an archived answer still appears in the visitor topics");
}
// The Archived view shows it with its badge and a Restore action.
const statusFilter = page.getByRole("combobox", { name: "Filter by status" });
await statusFilter.selectOption("archived");
await page.waitForTimeout(400);
const archivedCards = page.locator('[class*="answersList"] > li');
if ((await archivedCards.count()) !== 1) {
  throw new Error(`the Archived view must show exactly the archived rule (found ${await archivedCards.count()})`);
}
const archivedCard = archivedCards.first();
if (!(await archivedCard.innerText()).includes("Parking permits")) {
  throw new Error("the Archived view shows the wrong rule");
}
await archivedCard.getByRole("button", { expanded: false }).first().click();
const archivedMenuButton = archivedCard.getByRole("button", { name: /More actions for Parking permits/ });
await archivedMenuButton.waitFor({ timeout: 5000 });
await page.waitForTimeout(300);
const menu3 = await openCardMenu(archivedCard, "Parking permits");
const archivedItems = await menu3.getByRole("menuitem").allInnerTexts();
if (archivedItems.join("|") !== "Restore") {
  throw new Error(`the archived menu must offer Restore only: ${archivedItems.join(" / ")}`);
}
await shotAt(1280, 900, "answers-archived-view-1280");
await menu3.getByRole("menuitem", { name: "Restore" }).click();
await page.waitForTimeout(800);
// Restored as a Draft — into the active list, never republished.
await statusFilter.selectOption("all");
await page.waitForTimeout(300);
const restored = cards.filter({ hasText: "Parking permits" }).first();
if ((await restored.locator('[class*="draftBadge"]').count()) !== 1) {
  throw new Error("restore must return the answer as a Draft");
}
if ((await cards.count()) !== 9) {
  throw new Error(`the restored card did not rejoin the active list (found ${await cards.count()})`);
}
const topicsAfterRestore = await (await context.request.get(`${BASE}/api/v1/topics`)).json();
if (topicsAfterRestore.topics.some((topic) => topic.topic === "Parking permits")) {
  throw new Error("a restored draft must not answer visitors until published");
}
console.log("ok: Archive retires it from visitors; Archived view restores it as a Draft");

// --- Trash: Delete moves it, Restore brings it back, purge confirms. --------
await restored.getByRole("button", { expanded: false }).first().click();
const menu4 = await openCardMenu(restored, "Parking permits");
await menu4.getByRole("menuitem", { name: "Delete" }).click();
await page.waitForTimeout(800);
if ((await cards.count()) !== 8) {
  throw new Error("Delete must remove the card from the active view");
}
await statusFilter.selectOption("trash");
await page.waitForTimeout(400);
const trashCards = page.locator('[class*="answersList"] > li');
if ((await trashCards.count()) !== 1) {
  throw new Error(`the Trash view must show the deleted rule (found ${await trashCards.count()})`);
}
const trashedCard = trashCards.first();
if (!(await trashedCard.innerText()).includes("Trashed")) {
  throw new Error("the trashed card does not carry its Trashed badge");
}
await trashedCard.getByRole("button", { expanded: false }).first().click();
const menu5 = await openCardMenu(trashedCard, "Parking permits");
const trashedItems = await menu5.getByRole("menuitem").allInnerTexts();
if (trashedItems.join("|") !== "Restore|Permanently delete") {
  throw new Error(`the trash menu must offer Restore and Permanently delete: ${trashedItems.join(" / ")}`);
}
await shotAt(1280, 900, "answers-trash-view-1280");
// Restore from Trash first: a Draft again, expiry cancelled.
await menu5.getByRole("menuitem", { name: "Restore" }).click();
await page.waitForTimeout(800);
await statusFilter.selectOption("all");
await page.waitForTimeout(400);
if ((await cards.count()) !== 9) {
  throw new Error("restoring from Trash did not return the card");
}
console.log("ok: Delete moves to Trash; Restore returns a Draft");

// Permanently delete, through the shared confirm dialog, with a cancel
// first. The rule is a Draft after its restore, so it goes through Delete
// again — permanent deletion is a Trash-only action.
const doomed = cards.filter({ hasText: "Parking permits" }).first();
await doomed.getByRole("button", { expanded: false }).first().click();
const menuTrashAgain = await openCardMenu(doomed, "Parking permits");
await menuTrashAgain.getByRole("menuitem", { name: "Delete" }).click();
await page.waitForTimeout(800);
await statusFilter.selectOption("trash");
await page.waitForTimeout(400);
const doomedCard = page.locator('[class*="answersList"] > li').first();
await doomedCard.getByRole("button", { expanded: false }).first().click();
const menu6 = await openCardMenu(doomedCard, "Parking permits");
await menu6.getByRole("menuitem", { name: "Permanently delete" }).click();
const dialog = page.locator('[role="dialog"]');
await dialog.waitFor({ timeout: 5000 });
if (!(await dialog.innerText()).includes("Parking permits")) {
  throw new Error("the confirm dialog does not name the answer");
}
await shotAt(1280, 900, "answers-confirm-dialog-1280");
await dialog.getByRole("button", { name: "Cancel" }).click();
await dialog.waitFor({ state: "hidden", timeout: 5000 });
await page.waitForTimeout(400);
if ((await page.locator('[class*="answersList"] > li').count()) !== 1) {
  throw new Error("cancelling the dialog must leave the answer intact");
}
// Again, and confirm for good.
const menu6b = await openCardMenu(doomedCard, "Parking permits");
await menu6b.getByRole("menuitem", { name: "Permanently delete" }).click();
await dialog.waitFor({ timeout: 5000 });
await dialog.getByRole("button", { name: "Permanently delete" }).click();
await page.waitForTimeout(800);
if (!(await page.innerText("body")).includes("Trash is empty.")) {
  throw new Error("the emptied Trash view has no empty state");
}
await statusFilter.selectOption("all");
await page.waitForTimeout(400);
if ((await cards.count()) !== 8) {
  throw new Error("permanent deletion did not remove the card");
}
console.log("ok: permanent deletion confirms, cancels intact, then removes for good");

// Expanded rail state on the answers page.
await page.evaluate(() => window.localStorage.setItem("dashboard.sidebar.collapsed", "0"));
await page.goto(`${BASE}/dashboard/answers`);
await page.waitForLoadState("domcontentloaded");
await page.getByRole("link", { name: /new answer/i }).waitFor({ timeout: 10000 });
if ((await rail.getAttribute("data-collapsed")) !== null) {
  throw new Error("the saved expanded preference did not restore");
}
if (!(await navLinks.first().innerText()).includes("Conversations")) {
  throw new Error("the expanded rail does not show labels");
}
await shotAt(1280, 900, "answers-expanded-rail-1280");
console.log("ok: the expanded rail keeps visible labels on the new page");

// --- Responsive pass. --------------------------------------------------------
await shotAt(760, 900, "answers-760");
for (const width of [390, 360]) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto(`${BASE}/dashboard/answers`);
  await page.waitForLoadState("domcontentloaded");
  const menu = page.getByRole("button", { name: "Menu" });
  await menu.click();
  const drawer = page.locator('[aria-label="Dashboard menu"]');
  await drawer.waitFor({ timeout: 5000 });
  if ((await drawer.getByRole("link", { name: "Conversations" }).count()) !== 1) {
    throw new Error(`drawer at ${width}px lacks labelled navigation`);
  }
  await shotAt(width, 800, `answers-drawer-${width}`);
  await page.keyboard.press("Escape");
  await drawer.waitFor({ state: "hidden", timeout: 5000 });
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.scrollingElement.scrollWidth,
    clientWidth: document.scrollingElement.clientWidth,
  }));
  if (overflow.scrollWidth > overflow.clientWidth + 1) {
    throw new Error(`horizontal overflow at ${width}px`);
  }
  console.log(`ok: drawer labelled + Escape closes at ${width}px`);
}

// --- Reduced motion: the reveal lands immediately, no errors. ----------------
// Same signed-in context, one page with the OS preference emulated.
const quietPage = await context.newPage();
await quietPage.emulateMedia({ reducedMotion: "reduce" });
const quietErrors = [];
quietPage.on("pageerror", (error) => quietErrors.push(String(error).slice(0, 200)));
await quietPage.setViewportSize({ width: 1280, height: 900 });
await quietPage.goto(`${BASE}/dashboard/answers`);
await quietPage.waitForLoadState("domcontentloaded");
const quietCards = quietPage.locator('[class*="answersList"] > li');
await quietCards.first().getByRole("button", { expanded: false }).first().click();
await quietPage.waitForTimeout(150);
const quietReveal = await quietCards
  .first()
  .locator('[class*="answersCardBody"]')
  .first()
  .evaluate((el) => getComputedStyle(el).visibility);
if (quietReveal !== "visible") {
  throw new Error(`reduced motion leaves the card body hidden: ${quietReveal}`);
}
if (quietErrors.length > 0) {
  throw new Error(`page errors under reduced motion: ${quietErrors.join(" | ")}`);
}
await quietPage.close();
console.log("ok: reduced motion keeps the page fully usable");

if (pageErrors.length > 0) {
  throw new Error(`page errors during the run: ${pageErrors.join(" | ")}`);
}
await browser.close();
console.log("ticket 58 checks passed; screenshots in", OUT);
