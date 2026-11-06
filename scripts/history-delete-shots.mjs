// Tickets 51 + 62 verification (headless Chromium): the History tab's Delete
// and Clear history controls behind the shared confirmation dialog. Signs
// the owner in through the real UI, seeds closed, quiet claimed, quiet
// waiting, and live claimed conversations through the real APIs, and walks
// the whole dialog contract live: live rows carry no Delete, every History
// row does (ticket 62), focus moves in, Escape/backdrop/Cancel close without
// deleting, a quiet waiting row deletes, a row that turns live while its
// dialog is open is refused inline and kept, Clear history (owner-only)
// counts and removes every History row while the live conversation
// survives, and deleting the open transcript returns to the list.
// Screenshots at 1280/390/360 with zero overflow.
// Usage: node scripts/history-delete-shots.mjs <outdir> [port]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { TOTP, URI } from "otpauth";
import process from "node:process";

const OUT = process.argv[2] ?? ".scratch/college-website-chat/references/shots-history-delete";
const PORT = process.argv[3] ?? "3215";
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = process.env.CHATBOT_DB ?? ".scratch/college-website-chat/history51.db";
const EMAIL = "owner@example.edu";
const PASSWORD = "Springfield2026!";
const HISTORY_URL = `${BASE}/dashboard/inbox/history`;

for (let attempt = 0; ; attempt++) {
  try {
    await fetch(`${BASE}/api/healthz`);
    break;
  } catch {
    if (attempt > 40) throw new Error("server never came up");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// A clean slate in this ticket's dedicated scratch database: enrollment plus
// every conversation (with the rows that reference them, removed in FK
// order), so reruns always start from an empty archive.
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
db.prepare("UPDATE audit_log SET conversation_id = NULL").run();
db.prepare("DELETE FROM return_tokens").run();
db.prepare("DELETE FROM visitor_sessions").run();
db.prepare("DELETE FROM messages").run();
db.prepare("DELETE FROM conversations").run();
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

// Row previews carry the literal LAST message (the bot's closure note), so
// rows are targeted structurally: closed rows are the ones with Delete
// buttons, the claimed row is the one without.
async function seedClosed(question) {
  return page.evaluate(async (q) => {
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
      question: await post(q),
      escalate: await post("Please let me speak to a human."),
    })) {
      if (!response.ok) throw new Error(`seed ${step} failed`);
    }
    for (const action of ["claim", "reply", "close"]) {
      const response = await fetch(`/api/staff/conversations/${conversation.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        ...(action === "reply" ? { body: JSON.stringify({ text: "Noted, thanks." }) } : {}),
      });
      if (!response.ok) throw new Error(`seed staff ${action} failed`);
    }
    return conversation.id;
  }, question);
}

for (const question of [
  "history51 one: When is the registrar open?",
  "history51 two: Do you offer campus tours?",
  "history51 three: Where is the science building?",
]) {
  await seedClosed(question);
}
// Ticket 62: History membership, not the closed state, is the deletion
// boundary. Two quiet non-closed rows (claimed, and waiting for staff) sit in
// History beside the closed ones; one live claimed conversation stays on the
// Conversations tab.
async function seedEscalated(question, { claim }) {
  return page.evaluate(
    async ({ q, claim: shouldClaim }) => {
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
        question: await post(q),
        escalate: await post("Please let me speak to a human."),
      })) {
        if (!response.ok) throw new Error(`seed ${step} failed`);
      }
      if (shouldClaim) {
        const claim = await fetch(`/api/staff/conversations/${conversation.id}/claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (!claim.ok) throw new Error("seed claim failed");
      }
      return conversation.id;
    },
    { q: question, claim },
  );
}
function setLastActivity(id, iso) {
  const conn = new DatabaseSync(DB_PATH);
  conn.prepare("UPDATE conversations SET last_activity_at = ? WHERE id = ?").run(iso, id);
  conn.close();
}
function conversationExists(id) {
  const conn = new DatabaseSync(DB_PATH);
  const row = conn.prepare("SELECT COUNT(*) AS n FROM conversations WHERE id = ?").get(id);
  conn.close();
  return row.n > 0;
}
const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
const quietClaimedId = await seedEscalated("Where is the gym?", { claim: true });
setLastActivity(quietClaimedId, twoDaysAgo);
const quietWaitingId = await seedEscalated("Can I defer my offer?", { claim: false });
setLastActivity(quietWaitingId, new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString());
const liveId = await seedEscalated("Is the library open late?", { claim: true });
console.log("seeded three closed + quiet claimed + quiet waiting + one live claimed");

// --- The live row offers no Delete on the Conversations tab. ---------------
await page.goto(`${BASE}/dashboard/inbox`);
await page.waitForLoadState("domcontentloaded");
await page.locator('nav[aria-label="Conversation list"]').waitFor({ timeout: 10000 });
if ((await page.locator(`a[href="/dashboard/inbox/${liveId}"]`).count()) !== 1) {
  throw new Error("the live conversation must be listed on the Conversations tab");
}
if ((await page.getByRole("button", { name: "Delete this conversation" }).count()) !== 0) {
  throw new Error("live rows must never offer Delete");
}
console.log("ok: live rows carry no Delete control");

await page.goto(HISTORY_URL);
await page.waitForLoadState("domcontentloaded");
await page.locator('nav[aria-label="Conversation list"]').waitFor({ timeout: 10000 });

const nav = page.locator('nav[aria-label="Conversation list"]');
const deleteButtons = nav.locator('[aria-label="Delete this conversation"]');
const rows = nav.locator('[class*="deskItemWrap"]');
// For row-relative filtering, the has-locator is created from the page root
// (relative to whatever element filters with it).
const rowHasDelete = page.getByRole("button", { name: "Delete this conversation" });
const rowFor = (id) => rows.filter({ has: page.locator(`a[href="/dashboard/inbox/${id}"]`) });

if ((await rows.count()) !== 5) {
  throw new Error(`expected five History rows (3 closed + 2 quiet), found ${await rows.count()}`);
}
if ((await deleteButtons.count()) !== 5) {
  throw new Error(`every History row must offer Delete, found ${await deleteButtons.count()} of 5`);
}
if ((await rowFor(liveId).count()) !== 0) {
  throw new Error("the live conversation must not appear in History");
}
const clearButton = page.getByRole("button", { name: "Clear history" });
if ((await clearButton.count()) !== 1) {
  throw new Error("the owner must see Clear history while History has rows");
}
console.log("ok: Delete on all five History rows (closed and quiet); Clear history visible");

const dialog = page.locator('[role="dialog"]');

async function openDialog(trigger = deleteButtons.first()) {
  await trigger.click();
  await dialog.waitFor({ timeout: 5000 });
}
async function closeAndCheckFocus() {
  await dialog.waitFor({ state: "detached", timeout: 5000 });
  const focusedLabel = await page.evaluate(
    () => document.activeElement?.getAttribute("aria-label"),
  );
  if (focusedLabel !== "Delete this conversation") {
    throw new Error(`focus did not return to the trigger (found: ${focusedLabel})`);
  }
}

// --- Escape closes without deleting; focus returns to the trigger. --------
await openDialog();
if (
  (await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') != null)) !== true
) {
  throw new Error("opening the dialog did not move focus into it");
}
// Headings render uppercased by the dashboard's h2 style, so match case-
// insensitively against innerText.
const dialogText = (await dialog.innerText()).toLowerCase();
for (const phrase of ["delete this conversation?", "permanently", "contact details", "closed or inactive"]) {
  if (!dialogText.includes(phrase)) {
    throw new Error(`the delete dialog never says "${phrase}"; text: ${dialogText.slice(0, 200)}`);
  }
}
await page.keyboard.press("Escape");
await closeAndCheckFocus();
if ((await deleteButtons.count()) !== 5) {
  throw new Error("Escape must not delete");
}
console.log("ok: focus enters on open; Escape closes, focus returns, nothing deleted");

// --- Backdrop click cancels. ------------------------------------------------
await openDialog();
await page.locator('[class*="modalOverlay"]').click({ position: { x: 8, y: 8 } });
await closeAndCheckFocus();
console.log("ok: a backdrop click cancels");

// --- Cancel button cancels. --------------------------------------------------
await openDialog();
await dialog.getByRole("button", { name: "Cancel" }).click();
await closeAndCheckFocus();
console.log("ok: Cancel closes safely");

// --- A quiet row waiting for staff deletes like a closed one. --------------
await openDialog(rowFor(quietWaitingId).getByRole("button", { name: "Delete this conversation" }));
const waitingText = (await dialog.innerText()).toLowerCase();
if (!waitingText.includes("waiting")) {
  throw new Error(`the dialog must identify the waiting conversation (text: ${waitingText.slice(0, 200)})`);
}
await dialog.getByRole("button", { name: "Delete", exact: true }).click();
await page.waitForFunction(
  () => document.querySelectorAll('[aria-label="Delete this conversation"]').length === 4,
  { timeout: 10000 },
);
if ((await dialog.count()) !== 0) {
  throw new Error("the dialog must close after a successful delete");
}
if (conversationExists(quietWaitingId)) {
  throw new Error("the quiet waiting conversation was not deleted");
}
console.log("ok: a quiet waiting-for-staff row deleted after confirming");
await page.screenshot({ path: join(OUT, "after-delete-row-1280.png"), fullPage: true });

// --- A row that turned live after the list rendered is refused and kept. ---
await openDialog(rowFor(quietClaimedId).getByRole("button", { name: "Delete this conversation" }));
setLastActivity(quietClaimedId, new Date().toISOString());
await dialog.getByRole("button", { name: "Delete", exact: true }).click();
await dialog.locator('[role="alert"]').waitFor({ timeout: 10000 });
const refusal = (await dialog.locator('[role="alert"]').innerText()).toLowerCase();
if (!refusal.includes("live")) {
  throw new Error(`the refusal must explain the conversation is live (found: ${refusal})`);
}
await page.screenshot({ path: join(OUT, "after-delete-refused-live-1280.png"), fullPage: false });
await dialog.getByRole("button", { name: "Cancel" }).click();
await dialog.waitFor({ state: "detached", timeout: 5000 });
if (!conversationExists(quietClaimedId)) {
  throw new Error("a conversation that turned live must survive the refused delete");
}
console.log("ok: a row that turned live mid-dialog is refused inline and kept");

// --- Clear history: the count covers every History row; live rows stay. ---
// Back to quiet: the claimed row returns to History for the clear.
setLastActivity(quietClaimedId, twoDaysAgo);
await page.goto(HISTORY_URL);
await page.waitForLoadState("domcontentloaded");
await rows.first().waitFor({ timeout: 10000 });
if ((await rows.count()) !== 4) {
  throw new Error(`expected four History rows before the clear, found ${await rows.count()}`);
}
await clearButton.click();
await dialog.waitFor({ timeout: 5000 });
const clearText = (await dialog.innerText()).toLowerCase();
if (!clearText.includes("4 history conversations")) {
  throw new Error(`the clear dialog must state the full History count (found: ${clearText.slice(0, 200)})`);
}
for (const phrase of ["closed or inactive", "live conversations"]) {
  if (!clearText.includes(phrase)) {
    throw new Error(`the clear dialog never says "${phrase}" (found: ${clearText.slice(0, 200)})`);
  }
}
await page.screenshot({ path: join(OUT, "after-clear-dialog-1280.png"), fullPage: false });
await dialog.getByRole("button", { name: "Clear history" }).click();
await dialog.waitFor({ state: "detached", timeout: 10000 });
await page.waitForFunction(
  () => document.querySelectorAll('[aria-label="Delete this conversation"]').length === 0,
  { timeout: 10000 },
);
if ((await rows.count()) !== 0) {
  throw new Error(`History must be empty after the clear (found ${await rows.count()})`);
}
if ((await clearButton.count()) !== 0) {
  throw new Error("Clear history must hide when History is empty");
}
if (conversationExists(quietClaimedId)) {
  throw new Error("the quiet claimed row must be cleared with the rest of History");
}
if (!conversationExists(liveId)) {
  throw new Error("the live conversation must survive Clear history");
}
console.log("ok: clear history removed every History row (closed and quiet); the live one survived");
await page.screenshot({ path: join(OUT, "after-clear-history-1280.png"), fullPage: true });

// --- Deleting the currently open transcript returns to the list. ------------
// Re-seed one closed row, open its transcript via the row link, and delete
// it from the open pane: the desk must land back on the History list. The
// freshly seeded conversation is the newest activity, so it is the FIRST
// closed row in the newest-first list; the URL assert proves the identity.
const reopenId = await seedClosed("history51 four: Is there a dorm tour?");
await page.goto(HISTORY_URL);
await page.waitForLoadState("domcontentloaded");
const newestClosedRow = rows.filter({ has: rowHasDelete }).first();
await newestClosedRow.waitFor({ timeout: 10000 });
await newestClosedRow.locator("a").click();
await page.waitForURL(`**/dashboard/inbox/${reopenId}`, { timeout: 10000 });
await page
  .locator('section[aria-label="Selected conversation"]')
  .locator('[class*="bubble"]')
  .first()
  .waitFor({ timeout: 10000 });
// The open conversation's own row now carries the selected state; delete it.
await nav
  .locator('[class*="deskItemWrap"][data-selected], [class*="deskItemWrap"]:has([data-selected])')
  .getByRole("button", { name: "Delete this conversation" })
  .click();
await dialog.waitFor({ timeout: 5000 });
await dialog.getByRole("button", { name: "Delete", exact: true }).click();
await page.waitForURL("**/dashboard/inbox/history", { timeout: 10000 });
console.log("ok: deleting the open transcript returns staff to the History list");

// --- Narrow widths: the Delete control fits beside the row. -----------------
// The ticket names 360px; 390 (iPhone) is swept alongside it. History is
// empty by now (ticket 62's clear leaves no quiet survivor), so one closed
// and one quiet row are seeded for the narrow shots.
await seedClosed("history62 narrow: Where do I collect my ID card?");
setLastActivity(await seedEscalated("Who handles housing?", { claim: true }), twoDaysAgo);
await page.goto(HISTORY_URL);
await page.waitForLoadState("domcontentloaded");
for (const width of [360, 390]) {
  await page.setViewportSize({ width, height: 850 });
  await page.waitForTimeout(350);
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.scrollingElement.scrollWidth,
    clientWidth: document.scrollingElement.clientWidth,
  }));
  if (overflow.scrollWidth > overflow.clientWidth + 1) {
    throw new Error(`horizontal overflow at ${width}px on the History list`);
  }
  await rows.first().locator('[class*="deskItemPreview"]').waitFor({ timeout: 10000 });
  await page.screenshot({
    path: join(OUT, `after-history-${width}.png`),
    fullPage: false,
  });
  console.log(`captured after-history-${width} (no overflow)`);
}

if (pageErrors.length > 0) {
  throw new Error(`page errors during the run: ${pageErrors.join(" | ")}`);
}
await browser.close();
console.log("ticket 51 + 62 checks passed; screenshots in", OUT);
