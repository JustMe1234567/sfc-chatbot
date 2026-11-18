// Ticket 67 certification (headless Chromium, one-off): the click-to-handoff
// options. Drives the real widget on the demo page — the three seeded
// options stacked under the topic chips on the fresh chat, hiding while the
// visitor types, a click recording the label as the visitor's words with a
// truthful topic acknowledgment and the waiting lock engaging, a repeat
// click refused with exactly one alert recorded — then proves typed wording
// keeps normal answer matching against a competing published rule, signs the
// owner in through the real UI (fresh TOTP enrollment) for the desk's
// waiting row, Take over and a staff reply, and the Answers admin area's
// Handoff Options tab, whose save reaches a new widget without a redeploy.
// Usage: node scripts/cert67-handoff-options.mjs <outdir> [port]
// Dev-mode only (ticket 78): under a production build the ticket-76 embed
// allowlist denies the loopback demo origin — the probe below fails fast.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { TOTP, URI } from "otpauth";
import process from "node:process";

const OUT =
  process.argv[2] ?? ".scratch/college-website-chat/references/ticket67";
const BASE = `http://127.0.0.1:${process.argv[3] ?? "3231"}`;
const DB_PATH =
  process.env.CHATBOT_DB ?? ".scratch/college-website-chat/ticket67.db";
const EMAIL = "owner@example.edu";
const PASSWORD = "Springfield2026!";

const ADMISSIONS_OPTION = "I want to speak to someone in admissions";
const COURSE_PRICES_OPTION = "I have a question about course prices";
const FINANCIAL_AID_OPTION = "I have a question about financial aid";
const REGISTRAR_OPTION = "Please connect me with the registrar";
const AID_RULE_RESPONSE = "Cert 67: the aid office answers this rule directly.";

for (let attempt = 0; ; attempt++) {
  try {
    await fetch(`${BASE}/api/healthz`);
    break;
  } catch {
    if (attempt > 40) throw new Error("server never came up");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// Ticket 78 guard: the widget steps drive the demo page, which must be an
// allowed widget host — this cert is dev-mode-only.
{
  const eligibility = await (
    await fetch(`${BASE}/api/v1/embed-eligibility?origin=${encodeURIComponent(BASE)}`)
  ).json();
  if (eligibility.allowed !== true) {
    throw new Error(
      `the demo origin ${BASE} is not an allowed widget host on this server — under a production build the ticket-76 embed allowlist admits only allowlisted HTTPS origins. ` +
        `Run \`next dev\` with CHATBOT_BASE_URL=${BASE} and re-run this cert against that origin.`,
    );
  }
}

// Any chatbot route initializes the service singleton (migrations + seed
// rules); healthz alone does not — and the enrollment wipe below needs the
// tables.
const topicsResponse = await fetch(`${BASE}/api/v1/topics`);
if (!topicsResponse.ok) throw new Error(`topics fetch failed: ${topicsResponse.status}`);

const optionsResponse = await fetch(`${BASE}/api/v1/handoff-options`);
if (!optionsResponse.ok) throw new Error(`options fetch failed: ${optionsResponse.status}`);
const seededOptions = (await optionsResponse.json()).options;
if (JSON.stringify(seededOptions) !== JSON.stringify([ADMISSIONS_OPTION, COURSE_PRICES_OPTION, FINANCIAL_AID_OPTION])) {
  throw new Error(`the seeded options are not the three pictured phrases: ${JSON.stringify(seededOptions)}`);
}

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

// A published rule that deliberately covers the same topic as the
// financial-aid option: the click must bypass it, typing must not.
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
await withDbLockRetry(() => {
  const conn = new DatabaseSync(DB_PATH);
  try {
    conn.prepare(
      "INSERT INTO answer_rules (id, topic, response, link, phrases, keywords, status, updated_at, published_by, reviewed_at, trashed_at) VALUES (?, ?, ?, NULL, ?, NULL, 'published', ?, NULL, ?, NULL)",
    ).run(
      "aid-cert-67",
      "Financial aid",
      AID_RULE_RESPONSE,
      JSON.stringify(["financial aid"]),
      new Date().toISOString(),
      new Date().toISOString(),
    );
  } finally {
    conn.close();
  }
});
console.log("seeded the competing published rule");

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
const optionsGroup = frame.locator('[aria-label="Options to reach our staff"]');

async function shot(name) {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
  console.log("captured", name);
}

// ===========================================================================
// Part A — the widget: options on the fresh chat, hidden while typing, and
// the click that hands off exactly once.
// ===========================================================================
await page.goto(`${BASE}/demo/wordpress-test-page.html`);
await page.waitForLoadState("domcontentloaded");
await page.locator(".sfcw-launcher").click();
await gateName.waitFor({ timeout: 10000 });
await frame.locator("#sfcw-email").fill(CONTACT.email);
await frame.locator("#sfcw-phone").fill(CONTACT.phone);
await gateName.fill(CONTACT.fullName);
await frame.getByRole("button", { name: "Start chat" }).click();
await composer.waitFor({ timeout: 10000 });

// The fresh chat stacks the topic chips and, below them, the three options
// in their configured order.
await optionsGroup.waitFor({ timeout: 10000 });
const topicChips = await frame.locator('[aria-label="Suggested questions"] button').allTextContents();
const optionChips = await optionsGroup.locator("button").allTextContents();
if (JSON.stringify(optionChips) !== JSON.stringify([ADMISSIONS_OPTION, COURSE_PRICES_OPTION, FINANCIAL_AID_OPTION])) {
  throw new Error(`the fresh options are wrong: ${JSON.stringify(optionChips)}`);
}
if (!topicChips.includes("Financial aid")) {
  throw new Error(`the competing rule's topic chip is missing: ${JSON.stringify(topicChips)}`);
}
await shot("67-fresh-options");
console.log("ok: the fresh chat stacks the three options in order beside the topic chips");

// Typing a nonblank question hides the options; clearing brings them back.
await composer.fill("hello there");
if ((await optionsGroup.count()) !== 0) {
  throw new Error("the options stayed visible while the visitor typed");
}
await composer.fill("");
await optionsGroup.waitFor({ timeout: 10000 });
console.log("ok: the options hide while typing and return when the input is cleared");

// Clicking one option — via the keyboard, focus plus Enter — records the
// label as the visitor's words, appends the truthful acknowledgment, and
// locks the conversation for staff.
await composer.fill("");
const aidButton = optionsGroup.getByRole("button", { name: FINANCIAL_AID_OPTION });
await aidButton.focus();
await aidButton.press("Enter");
const log = frame.locator('[role="log"]');
await log.getByText(FINANCIAL_AID_OPTION).waitFor({ timeout: 10000 });
await log.getByText("Thanks for asking about financial aid.").waitFor({ timeout: 10000 });
const handoffNotice = frame.getByText("College staff will reply in this chat.");
await handoffNotice.waitFor({ timeout: 10000 });
if (!(await composer.isDisabled())) {
  throw new Error("the composer did not lock after the handoff click");
}
if ((await optionsGroup.count()) !== 0) {
  throw new Error("the options stayed visible in the waiting state");
}
await shot("67-clicked-waiting");
console.log("ok: the click records the words, acknowledges the topic, and locks the chat");

// The waiting lock refuses a repeat click server-side, and exactly one
// alert exists for the conversation.
const clickSession = await frame
  .locator("body")
  .evaluate(() => JSON.parse(sessionStorage.getItem("sfc_chatbot_v1_session") ?? "null"));
if (!clickSession?.id || !clickSession?.token) {
  throw new Error("no visitor credential after the gate");
}
const repeat = await postMessage(clickSession, { handoffOption: ADMISSIONS_OPTION });
if (repeat.status !== 409 || (await repeat.json()).error?.code !== "awaiting_staff") {
  throw new Error(`a repeat click during the wait was not refused (${repeat.status})`);
}
await withDbLockRetry(() => {
  const conn = new DatabaseSync(DB_PATH);
  try {
    const row = conn
      .prepare(
        "SELECT COUNT(*) AS n FROM notifications WHERE type = 'escalation_alert' AND conversation_id = ?",
      )
      .get(clickSession.id);
    if (row.n !== 1) {
      throw new Error(`expected exactly one escalation alert, found ${row.n}`);
    }
  } finally {
    conn.close();
  }
});
console.log("ok: the repeat click is refused and exactly one alert is recorded");

// Typing the same wording follows normal answer matching — the competing
// rule answers, no handoff, exactly as the ticket demands.
const typedChat = await startChat({ ...CONTACT, fullName: "Ruth Okafor" });
const typed = await (await postMessage(typedChat, { text: FINANCIAL_AID_OPTION })).json();
if (typed.conversation.state !== "bot_active" || typed.reply?.text !== AID_RULE_RESPONSE) {
  throw new Error(`typing the option wording did not follow the rule: ${JSON.stringify(typed.reply)}`);
}
if (typed.reply?.choices) {
  throw new Error("the typed wording unexpectedly offered a handoff choice");
}
console.log("ok: typing the same wording keeps normal answer matching");

// ===========================================================================
// Part B — the desk: the waiting row, Take over, and the staff reply.
// ===========================================================================
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
if ((await list.getByText("Jane Doe · waiting").count()) < 1) {
  throw new Error("no waiting row for the handoff click");
}
const waitingDot = await list.getByRole("img", { name: "Needs human" }).first().evaluate(
  (el) => getComputedStyle(el).backgroundColor,
);
if (waitingDot !== "rgb(76, 175, 125)") throw new Error(`waiting dot is not green: ${waitingDot}`);
await shot("67-desk-waiting");
console.log("ok: the desk shows the handoff as a waiting row with attention feedback");

await Promise.all([
  page.waitForURL(/\/dashboard\/inbox\//, { timeout: 15000 }),
  list.getByRole("link").filter({ hasText: "Jane Doe" }).first().click(),
]);
const pane = page.getByRole("region", { name: "Selected conversation" });
await pane.getByText("Jane Doe · waiting").first().waitFor({ timeout: 10000 });
await pane.getByRole("button", { name: "Take over" }).click();
await pane.getByText("Jane Doe · claimed").first().waitFor({ timeout: 15000 });
const replyBox = pane.locator('textarea[placeholder="Type your reply to the visitor"]');
await replyBox.fill("Hi, Jane — Dana from the aid office here. How can I help?");
await pane.getByRole("button", { name: "Send reply" }).click();
await pane.getByText("Dana from the aid office here.").waitFor({ timeout: 10000 });
await shot("67-pane-claimed-reply");
console.log("ok: staff Take over and reply in the same chat");

// ===========================================================================
// Part C — the Answers admin area: the options tab edits without a redeploy.
// ===========================================================================
await page.goto(`${BASE}/dashboard/answers`);
await page.getByRole("tab", { name: "Handoff Options" }).click();
const optionsPanel = page.locator("#answers-panel-options");
await optionsPanel.locator("#handoff-options").waitFor({ timeout: 10000 });
await shot("67-answers-options-tab");
await optionsPanel.locator("#handoff-options").fill(
  [ADMISSIONS_OPTION, FINANCIAL_AID_OPTION, REGISTRAR_OPTION].join("\n"),
);
await optionsPanel.getByRole("button", { name: "Save options" }).click();
await optionsPanel.getByText("Handoff options saved.").waitFor({ timeout: 10000 });
console.log("ok: the options tab saves an edited list");

// A new visitor (fresh tab, fresh session storage) sees the edited options
// on the very next widget open.
const visitorPage = await context.newPage();
visitorPage.on("pageerror", (error) => {
  pageErrors.push(String(error).slice(0, 300));
});
await visitorPage.setViewportSize({ width: 1280, height: 800 });
await visitorPage.goto(`${BASE}/demo/wordpress-test-page.html`);
await visitorPage.waitForLoadState("domcontentloaded");
await visitorPage.locator(".sfcw-launcher").click();
const visitorFrame = visitorPage.frameLocator(".sfcw-frame");
await visitorFrame.locator("#sfcw-name").waitFor({ timeout: 10000 });
await visitorFrame.locator("#sfcw-name").fill("Wei Chen");
await visitorFrame.locator("#sfcw-email").fill(CONTACT.email);
await visitorFrame.locator("#sfcw-phone").fill(CONTACT.phone);
await visitorFrame.getByRole("button", { name: "Start chat" }).click();
const visitorOptions = visitorFrame.locator('[aria-label="Options to reach our staff"]');
await visitorOptions.waitFor({ timeout: 10000 });
const edited = await visitorOptions.locator("button").allTextContents();
if (JSON.stringify(edited) !== JSON.stringify([ADMISSIONS_OPTION, FINANCIAL_AID_OPTION, REGISTRAR_OPTION])) {
  throw new Error(`the edited options did not reach the widget: ${JSON.stringify(edited)}`);
}
// After a bot answer the options return: typing a question the seeded Fees
// rule answers, then watching the chips come back with the reply.
const visitorComposer = visitorFrame.locator('textarea[placeholder="Type your question"]');
await visitorComposer.fill("What are the tuition fees?");
await visitorComposer.press("Enter");
await visitorFrame.getByText("$3,500").waitFor({ timeout: 15000 });
await visitorOptions.waitFor({ timeout: 10000 });
const afterAnswer = await visitorOptions.locator("button").allTextContents();
if (JSON.stringify(afterAnswer) !== JSON.stringify([ADMISSIONS_OPTION, FINANCIAL_AID_OPTION, REGISTRAR_OPTION])) {
  throw new Error(`the options did not return after the bot answer: ${JSON.stringify(afterAnswer)}`);
}
await visitorPage.screenshot({ path: join(OUT, "67-options-updated.png"), fullPage: false });
console.log("captured 67-options-updated");
console.log("ok: the edited list reaches a new visitor without a redeploy, and the options return after a bot answer");

if (pageErrors.length > 0) {
  throw new Error(`page errors during the run: ${pageErrors.join(" | ")}`);
}
await browser.close();
console.log("ticket 67 checks passed;");
console.log("screenshots in", OUT);
