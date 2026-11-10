// Ticket 66 certification (headless Chromium, one-off): the required visitor
// contact gate and the desk's name labels and re-colored tiers. Drives the
// real widget on the demo page — form first, server-side rejection of a bad
// phone, accepted details opening the chat, the gate returning after Clear
// chat, and a direct-API bypass attempt against a legacy conversation —
// then signs the owner in through the real UI (fresh TOTP enrollment) to
// assert "Name · state" rows, the fallback label, the green/yellow/red tier
// colors by computed style, and the Visitor emails page's new copy.
// Usage: node scripts/cert66-widget-gate.mjs <outdir> [port]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { TOTP, URI } from "otpauth";
import process from "node:process";

const OUT =
  process.argv[2] ?? ".scratch/college-website-chat/references/ticket66";
const BASE = `http://127.0.0.1:${process.argv[3] ?? "3222"}`;
const DB_PATH =
  process.env.CHATBOT_DB ?? ".scratch/college-website-chat/ticket66.db";
const EMAIL = "owner@example.edu";
const PASSWORD = "Springfield2026!";

for (let attempt = 0; ; attempt++) {
  try {
    await fetch(`${BASE}/api/healthz`);
    break;
  } catch {
    if (attempt > 40) throw new Error("server never came up");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// Any chatbot route initializes the service singleton (migrations + seed
// rules); healthz alone does not — and the enrollment wipe below needs the
// tables.
const topicsResponse = await fetch(`${BASE}/api/v1/topics`);
if (!topicsResponse.ok) throw new Error(`topics fetch failed: ${topicsResponse.status}`);

// A clean enrollment slate (same as the other screenshot scripts).
const db = new DatabaseSync(DB_PATH);
const owner = db.prepare('SELECT id FROM "user" WHERE email = ?').get(EMAIL);
if (owner) {
  db.prepare("DELETE FROM twoFactor WHERE userId = ?").run(owner.id);
  db.prepare('UPDATE "user" SET "twoFactorEnabled" = 0 WHERE id = ?').run(owner.id);
  db.prepare('DELETE FROM "session" WHERE "userId" = ?').run(owner.id);
  console.log("wiped prior enrollment for", EMAIL);
}
db.close();

const CONTACT = {
  fullName: "Jane Doe",
  email: "jane.doe@example.org",
  phone: "(555) 010-0199",
};

async function startChat(contact = CONTACT) {
  const response = await fetch(`${BASE}/api/v1/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(contact),
  });
  if (!response.ok) throw new Error(`conversation start failed: ${response.status}`);
  return response.json();
}

async function postMessage(conversation, body) {
  return fetch(`${BASE}/api/v1/conversations/${conversation.id}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${conversation.token}`,
    },
    body: JSON.stringify(body),
  });
}

// A conversation from before the gate: no contact details, but a live
// visitor credential — exactly what a pre-ticket session still holds.
/** The running server holds this same SQLite file; an out-of-process write
    can land mid-checkpoint, so give it a few tries. */
async function withDbLockRetry(write) {
  for (let attempt = 0; ; attempt++) {
    try {
      return write();
    } catch (error) {
      if (attempt > 8 || !String(error).includes("database is locked")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}

async function seedLegacyConversation(state, closedAt = null) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const token = `${randomUUID()}${randomUUID()}`.replace(/-/g, "").slice(0, 43);
  await withDbLockRetry(() => {
    const conn = new DatabaseSync(DB_PATH);
    try {
      conn.prepare(
        "INSERT INTO conversations (id, state, created_at, visitor_last_seen_at, last_activity_at, closed_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(id, state, now, now, now, closedAt);
      conn.prepare(
        "INSERT INTO visitor_sessions (token_hash, conversation_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
      ).run(
        createHash("sha256").update(token).digest("hex"),
        id,
        now,
        new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      );
    } finally {
      conn.close();
    }
  });
  return { id, token };
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => {
  pageErrors.push(String(error).slice(0, 300));
  console.log("PAGE ERROR:", String(error).slice(0, 300));
});
await page.setViewportSize({ width: 1280, height: 800 });
mkdirSync(OUT, { recursive: true });

const frame = page.frameLocator(".sfcw-frame");
const composer = frame.locator('textarea[placeholder="Type your question"]');
const gateName = frame.locator("#sfcw-name");

async function shot(name) {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
  console.log("captured", name);
}

// ===========================================================================
// Part A — the widget's contact gate.
// ===========================================================================
await page.goto(`${BASE}/demo/wordpress-test-page.html`);
await page.waitForLoadState("domcontentloaded");
await page.locator(".sfcw-launcher").click();
await gateName.waitFor({ timeout: 10000 });

// The gate is the first usable step: three labeled required fields, and
// nothing to ask with.
if ((await composer.count()) !== 0) {
  throw new Error("the composer is reachable before contact details are accepted");
}
if ((await frame.locator('[aria-label="Suggested questions"]').count()) !== 0) {
  throw new Error("topic suggestions are reachable before contact details are accepted");
}
const sessionBefore = await frame
  .locator("body")
  .evaluate(() => sessionStorage.getItem("sfc_chatbot_v1_session"));
if (sessionBefore !== null) {
  throw new Error("a fresh open minted a visitor credential before the form");
}
await shot("66-gate-form");

// A failed submission keeps the entered values and shows a clear error —
// the server's own rejection, not a browser validation.
await gateName.fill(CONTACT.fullName);
await frame.locator("#sfcw-email").fill(CONTACT.email);
await frame.locator("#sfcw-phone").fill("12345");
await frame.getByRole("button", { name: "Start chat" }).click();
const gateError = frame.locator('p[class*="contactError"]');
await gateError.waitFor({ timeout: 10000 });
const gateErrorText = await gateError.textContent();
if (!/valid phone/i.test(gateErrorText ?? "")) {
  throw new Error(`unexpected gate error copy: ${gateErrorText}`);
}
for (const [selector, expected] of [
  ["#sfcw-name", CONTACT.fullName],
  ["#sfcw-email", CONTACT.email],
  ["#sfcw-phone", "12345"],
]) {
  const value = await frame.locator(selector).inputValue();
  if (value !== expected) {
    throw new Error(`the failed submission did not keep ${selector}: "${value}"`);
  }
}
await shot("66-gate-error");

// The accepted details open the chat: greeting, suggestions, composer.
await frame.locator("#sfcw-phone").fill(CONTACT.phone);
await frame.getByRole("button", { name: "Start chat" }).click();
await composer.waitFor({ timeout: 10000 });
await frame.getByText("Hi! How can I help you today?").waitFor({ timeout: 10000 });
const started = await frame
  .locator("body")
  .evaluate(() => JSON.parse(sessionStorage.getItem("sfc_chatbot_v1_session") ?? "null"));
if (!started?.id || !started?.token) {
  throw new Error("an accepted submission did not yield a visitor credential");
}
await shot("66-chat-started");
console.log("ok: the gate opens on the form, rejects a bad phone server-side, and starts the chat");

// The server enforces the gate on direct API requests and legacy sessions:
// a pre-ticket conversation accepts nothing until details are accepted.
const legacy = await seedLegacyConversation("bot_active");
const bypass = await postMessage(legacy, { text: "A question posted straight at the API." });
if (bypass.status !== 409) {
  throw new Error(`the gate let a direct message through on a legacy conversation (${bypass.status})`);
}
if (((await bypass.json()).error?.code) !== "contact_required") {
  throw new Error("the gate's rejection lacks its stable code");
}
const unlock = await fetch(`${BASE}/api/v1/conversations/${legacy.id}/contact`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${legacy.token}`,
  },
  body: JSON.stringify({ ...CONTACT, fullName: "Legacy Lou" }),
});
if (unlock.status !== 200) {
  throw new Error(`the contact endpoint refused a legacy unlock (${unlock.status})`);
}
if ((await postMessage(legacy, { text: "Now the legacy chat works." })).status !== 200) {
  throw new Error("the unlocked legacy conversation still refused a message");
}
console.log("ok: direct API bypass refused, legacy unlock works, then chat works");

// Closing the widget does not bypass the gate: reopening a chat whose
// conversation has no accepted details shows the form again.
const reopenLegacy = await seedLegacyConversation("bot_active");
const legacyPage = await context.newPage();
await legacyPage.setViewportSize({ width: 1280, height: 800 });
await legacyPage.goto(`${BASE}/demo/wordpress-test-page.html`);
await legacyPage.waitForLoadState("domcontentloaded");
await legacyPage.evaluate((session) => {
  sessionStorage.setItem("sfc_chatbot_v1_session", JSON.stringify(session));
}, { id: reopenLegacy.id, token: reopenLegacy.token, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
await legacyPage.reload();
await legacyPage.locator(".sfcw-launcher").click();
const legacyGate = legacyPage.frameLocator(".sfcw-frame").locator("#sfcw-name");
await legacyGate.waitFor({ timeout: 10000 });
console.log("ok: reopening a detail-less conversation shows the form again");
await legacyPage.close();

// Clear chat asks again (the successor starts locked) — and the same
// details unlock the successor in place.
{
  // The overflow menu appears once the conversation has a message.
  await frame.locator('textarea[placeholder="Type your question"]').fill("How do I apply?");
  await frame.locator('textarea[placeholder="Type your question"]').press("Enter");
  await frame.locator('[role="log"]').getByText("How do I apply?").waitFor({ timeout: 10000 });
  const session = await frame
    .locator("body")
    .evaluate(() => JSON.parse(sessionStorage.getItem("sfc_chatbot_v1_session")));
  await frame.getByRole("button", { name: "Conversation options" }).click();
  await frame.getByRole("menuitem", { name: "Clear conversation" }).click();
  await frame.getByRole("button", { name: "Clear chat" }).click();
  await frame.locator('[role="log"]').getByText("Hi! How can I help you today?").waitFor({ state: "detached" });
  const successorGate = frame.locator("#sfcw-name");
  await successorGate.waitFor({ timeout: 10000 });
  if ((await composer.count()) !== 0) {
    throw new Error("the cleared chat's successor skipped the contact form");
  }
  const cleared = await frame
    .locator("body")
    .evaluate(() => JSON.parse(sessionStorage.getItem("sfc_chatbot_v1_session")));
  if (!cleared?.id || cleared.id === session.id) {
    throw new Error("clear did not swap to a fresh successor conversation");
  }
  await shot("66-gate-after-clear");
  await frame.locator("#sfcw-name").fill(CONTACT.fullName);
  await frame.locator("#sfcw-email").fill(CONTACT.email);
  await frame.locator("#sfcw-phone").fill(CONTACT.phone);
  await frame.getByRole("button", { name: "Start chat" }).click();
  await composer.waitFor({ timeout: 10000 });
  const resumed = await frame
    .locator("body")
    .evaluate(() => JSON.parse(sessionStorage.getItem("sfc_chatbot_v1_session")));
  if (resumed.id !== cleared.id) {
    throw new Error("the form after Clear started a second conversation instead of unlocking");
  }
  console.log("ok: Clear chat returns the gate and unlocks exactly one successor");
}

// ===========================================================================
// Part B — the desk: "Name · state" labels and the re-colored tiers.
// ===========================================================================
const waitingChat = await startChat({ ...CONTACT, fullName: "Priya Patel" });
if ((await (await postMessage(waitingChat, { text: "I want to speak to a human." })).json()).conversation.state !== "awaiting_staff") {
  throw new Error("expected an escalation for the waiting row");
}
const newMessageChat = await startChat({ ...CONTACT, fullName: "Ruth Okafor" });
await postMessage(newMessageChat, { text: "Screenshot seed: how much are the tuition fees?" });
const claimedChat = await startChat({ ...CONTACT, fullName: "Tomas Alvarez" });
if ((await (await postMessage(claimedChat, { text: "Claim test: please let me speak to a human." })).json()).conversation.state !== "awaiting_staff") {
  throw new Error("expected an escalation for the claimed row");
}
const legacyHistory = await seedLegacyConversation("closed", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());

// Sign the owner in through the real UI (fresh TOTP enrollment).
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

const list = page.getByRole("navigation", { name: "Conversation list" });
await list.waitFor({ timeout: 10000 });
await page.waitForTimeout(4000);

// The rows lead with the visitor's name beside the state.
for (const label of ["Priya Patel · waiting", "Ruth Okafor · bot", "Tomas Alvarez · waiting"]) {
  if ((await list.getByText(label).count()) < 1) {
    throw new Error(`no row labeled "${label}"`);
  }
}
console.log("ok: rows lead with Name · state");

// Tier treatments: green waiting, red new message, yellow active — each
// with its text, and the counts on their surfaces.
const needsHumanRows = list.getByText("Needs human", { exact: true });
if ((await needsHumanRows.count()) < 1) throw new Error("no Needs human badge");
const attentionRows = list.getByText("New message", { exact: true });
if ((await attentionRows.count()) < 1) throw new Error("no New message badge");
// The pills show real counts: the tab carries every standing attention
// episode, Incoming's pill every waiting escalation.
if ((await list.getByText(/^\d+ new$/).count()) !== 1) throw new Error("no attention tab count");
if ((await list.getByText(/^\d+ waiting$/).count()) !== 1) throw new Error("no waiting count");

const dotColor = async (name) => {
  const dot = list.getByRole("img", { name }).first();
  const style = await dot.evaluate((el) => getComputedStyle(el).backgroundColor);
  return style;
};
const green = await dotColor("Needs human");
const red = await dotColor("New message");
console.log("dot colors — waiting:", green, "new:", red);
if (green !== "rgb(76, 175, 125)") throw new Error(`waiting dot is not green: ${green}`);
if (red !== "rgb(226, 87, 74)") throw new Error(`new-message dot is not red: ${red}`);
await shot("66-desk-active");

// Claim the third chat, message it again, then open it: viewing clears the
// alert, and the claimed row reads yellow Active with its pane header
// leading with the same "Name · state" label.
await page.evaluate(async (id) => {
  const response = await fetch(`/api/staff/conversations/${id}/claim`, { method: "POST" });
  if (!response.ok) throw new Error(`claim failed: ${response.status}`);
}, claimedChat.id);
await postMessage(claimedChat, { text: "One more thing about the form, though." });
await page.waitForTimeout(5000);
await Promise.all([
  page.waitForURL(/\/dashboard\/inbox\//, { timeout: 15000 }),
  list.getByRole("link").filter({ hasText: "Tomas Alvarez" }).first().click(),
]);
const pane = page.getByRole("region", { name: "Selected conversation" });
await pane.getByText("Tomas Alvarez · claimed").first().waitFor({ timeout: 10000 });
console.log("ok: the selected pane header leads with Name · state");
const activeDot = await list.getByRole("img", { name: "Active" }).first().evaluate(
  (el) => getComputedStyle(el).backgroundColor,
);
console.log("active dot color:", activeDot);
if (activeDot !== "rgb(227, 167, 57)") throw new Error(`active dot is not yellow: ${activeDot}`);
await shot("66-pane-claimed");

// History keeps its neutral rows and the "Visitor" fallback label.
await page.goto(`${BASE}/dashboard/inbox/history`);
await page.getByRole("heading", { name: "History" }).waitFor({ timeout: 10000 });
await page.waitForTimeout(2500);
const historyList = page.getByRole("navigation", { name: "Conversation list" });
if ((await historyList.getByText("Visitor · closed").count()) < 1) {
  throw new Error("the legacy history row lacks its fallback label");
}
const historyDots = await historyList.getByRole("img").count();
if (historyDots !== 0) {
  throw new Error(`history rows must carry no status treatment, got ${historyDots}`);
}
await shot("66-desk-history");

// The Visitor emails page states the required capture.
await page.goto(`${BASE}/dashboard/emails`);
await page.locator("#emails-title").waitFor({ timeout: 10000 });
const emailsIntro = await page
  .locator("p")
  .filter({ hasText: "Every new chat starts with the visitor" })
  .count();
if (emailsIntro !== 1) {
  throw new Error("the Visitor emails page does not describe the required capture");
}
await shot("66-emails-page");

if (pageErrors.length > 0) {
  throw new Error(`page errors during the run: ${pageErrors.join(" | ")}`);
}
await browser.close();
console.log("ticket 66 checks passed;");
console.log("screenshots in", OUT);
