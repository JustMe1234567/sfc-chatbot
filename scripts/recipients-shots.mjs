// Ticket 54 verification (headless Chromium): the stacked recipient boxes.
// Signs the owner in through the real UI with a wiped alert list, then
// drives the real form: add appends a box and persists across reload,
// duplicate and malformed entries are refused inline, edit-in-place updates
// an address, delete removes a box, the last remaining box's Remove is
// disabled with its explanation, and the wrap layout holds at 360px.
// Screenshots after the flow at 1280 and 360.
// Usage: node scripts/recipients-shots.mjs <outdir> [port]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { TOTP, URI } from "otpauth";
import process from "node:process";

const OUT = process.argv[2] ?? ".scratch/college-website-chat/references/shots-recipients";
const PORT = process.argv[3] ?? "3217";
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = process.env.CHATBOT_DB ?? ".scratch/college-website-chat/history51.db";
const EMAIL = "owner@example.edu";
const PASSWORD = "Springfield2026!";
const PAGE_URL = `${BASE}/dashboard/notifications`;

for (let attempt = 0; ; attempt++) {
  try {
    await fetch(`${BASE}/api/healthz`);
    break;
  } catch {
    if (attempt > 40) throw new Error("server never came up");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// Light slate: enrollment plus the alert history and recipient setting, so
// the run starts from the empty stack the assertions expect.
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
db.close();

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

await page.goto(PAGE_URL);
await page.getByRole("heading", { name: "Staff alert recipients" }).waitFor({ timeout: 10000 });

const form = page.locator("form", { has: page.getByRole("heading", { name: "Staff alert recipients" }) });
const boxes = form.locator('[class*="recipientList"] > li');
const boxFor = (address) =>
  boxes.filter({ has: page.locator(`[class*="recipientAddress"]`, { hasText: address }) });
const addButton = form.getByRole("button", { name: "Add recipient" });

// --- Empty install: hint + Add area, no blank input, no boxes. -------------
if ((await boxes.count()) !== 0) {
  throw new Error("a wiped install must show no boxes");
}
if ((await form.getByText("No recipients yet").count()) !== 1) {
  throw new Error("the empty stack must explain itself");
}
console.log("ok: empty install shows the hint and the Add area");

// --- Add appends boxes and persists. ----------------------------------------
await page.fill("#recipient-add", "front-desk@example.edu");
await addButton.click();
await boxFor("front-desk@example.edu").waitFor({ timeout: 10000 });
await page.fill("#recipient-add", "registrar@example.edu");
await addButton.click();
await boxFor("registrar@example.edu").waitFor({ timeout: 10000 });
if ((await boxes.count()) !== 2) {
  throw new Error(`two adds must produce two boxes, found ${await boxes.count()}`);
}
await page.reload();
await page.waitForLoadState("domcontentloaded");
await form.getByRole("heading", { name: "Staff alert recipients" }).waitFor({ timeout: 10000 });
if ((await boxes.count()) !== 2) {
  throw new Error("the added boxes did not persist across a reload");
}
console.log("ok: add appends boxes immediately and persists");

// --- Duplicates and malformed entries are refused inline. -------------------
await page.fill("#recipient-add", "FRONT-DESK@example.edu");
await addButton.click();
await form.getByText("already on the list").waitFor({ timeout: 10000 });
if ((await boxes.count()) !== 2) {
  throw new Error("a duplicate add must not change the list");
}
await page.fill("#recipient-add", "not-an-address");
await addButton.click();
await form.getByText("doesn't look like an email address").waitFor({ timeout: 10000 });
console.log("ok: duplicate and malformed adds refused inline");

// --- Edit in place: bad value stays, Enter saves, Escape cancels. -----------
const registrarBox = boxFor("registrar@example.edu");
await registrarBox.getByRole("button", { name: "Edit registrar@example.edu" }).click();
const editInput = form.locator("#recipient-edit-1");
await editInput.waitFor({ timeout: 5000 });
await editInput.fill("front-desk@example.edu");
await editInput.press("Enter");
await form.getByText("already on the list").waitFor({ timeout: 10000 });
// Still in edit mode with the original value saved in the stack.
await editInput.fill("admissions@example.edu");
await editInput.press("Escape");
await boxFor("admissions@example.edu").waitFor({ timeout: 10000 }).catch(() => {});
if ((await boxFor("registrar@example.edu").count()) !== 1) {
  throw new Error("Escape must cancel the edit and keep the original address");
}
// Enter saves the new address in place.
await registrarBox.getByRole("button", { name: "Edit registrar@example.edu" }).click();
await editInput.fill("admissions@example.edu");
await editInput.press("Enter");
await page.getByText("Alert recipients saved.").waitFor({ timeout: 10000 });
if ((await boxFor("registrar@example.edu").count()) !== 0) {
  throw new Error("the edit did not replace the address in place");
}
if ((await boxFor("admissions@example.edu").count()) !== 1) {
  throw new Error("the edited box is missing");
}
console.log("ok: inline edit validates, cancels with Escape, saves with Enter");

// --- A failing save reverts the row and shows the server's error. -----------
// The next PUT is made to fail once; the optimistic box must come back off
// and the inline error must name the failure, with the saved list intact.
await page.route("**/api/staff/settings/alert-recipients", async (route) => {
  await route.fulfill({ status: 500, body: JSON.stringify({ error: { code: "boom", message: "The mail service refused the save." } }) });
}, { times: 1 });
await page.fill("#recipient-add", "housing@example.edu");
await addButton.click();
await form.getByText("The mail service refused the save.").waitFor({ timeout: 10000 });
if ((await boxes.count()) !== 2) {
  throw new Error("a failed add must leave the saved list unchanged");
}
if ((await form.getByText("housing@example.edu").count()) !== 0) {
  throw new Error("the failed add's box must revert");
}
// The route handler is spent; a retry through the real endpoint succeeds.
await page.fill("#recipient-add", "housing@example.edu");
await addButton.click();
await boxFor("housing@example.edu").waitFor({ timeout: 10000 });
if ((await boxes.count()) !== 3) {
  throw new Error(`the retried add must land, found ${await boxes.count()}`);
}
console.log("ok: a failed save reverts the row inline; a retry succeeds");

// --- Delete removes a box; the last box's Delete is disabled. ---------------
await page.setViewportSize({ width: 1280, height: 900 });
await boxFor("front-desk@example.edu")
  .getByRole("button", { name: "Delete front-desk@example.edu" })
  .click();
await boxFor("front-desk@example.edu").waitFor({ state: "detached", timeout: 10000 });
if ((await boxes.count()) !== 2) {
  throw new Error(`delete must shrink the stack, found ${await boxes.count()}`);
}
// Two remain: delete one more, leaving the single (protected) box.
await boxFor("admissions@example.edu")
  .getByRole("button", { name: "Delete admissions@example.edu" })
  .click();
await boxFor("admissions@example.edu").waitFor({ state: "detached", timeout: 10000 });
if ((await boxes.count()) !== 1) {
  throw new Error(`only the last box may remain, found ${await boxes.count()}`);
}
const lastDelete = boxFor("housing@example.edu").getByRole("button", {
  name: "Delete housing@example.edu",
});
if (!(await lastDelete.isDisabled())) {
  throw new Error("the last remaining box's Delete must be disabled");
}
if ((await form.getByText("At least one recipient must stay on the list").count()) !== 1) {
  throw new Error("the last-box rule must be explained inline");
}
console.log("ok: deletes remove boxes; the last box's Delete is disabled and explained");
await page.screenshot({ path: join(OUT, "after-recipients-1280.png"), fullPage: false });

// --- 360px: the address and its controls stack vertically. -------------------
await page.setViewportSize({ width: 360, height: 800 });
await page.waitForTimeout(350);
const overflow = await page.evaluate(() => ({
  scrollWidth: document.scrollingElement.scrollWidth,
  clientWidth: document.scrollingElement.clientWidth,
}));
if (overflow.scrollWidth > overflow.clientWidth + 1) {
  throw new Error("horizontal overflow at 360px on the recipients form");
}
const stacked = await page.evaluate(() => {
  const row = document.querySelector("[class*='recipientRow']");
  if (!row) return null;
  const address = row.querySelector("[class*='recipientAddress']");
  const controls = row.querySelector("[class*='recipientControls']");
  if (!address || !controls) return null;
  return controls.getBoundingClientRect().top >= address.getBoundingClientRect().bottom - 1;
});
if (stacked !== true) {
  throw new Error("at 360px the controls must stack under the address");
}
await page.screenshot({ path: join(OUT, "after-recipients-360.png"), fullPage: false });
console.log("captured after-recipients-360 (stacked rows, no overflow)");

if (pageErrors.length > 0) {
  throw new Error(`page errors during the run: ${pageErrors.join(" | ")}`);
}
await browser.close();
console.log("ticket 54 checks passed; screenshots in", OUT);
