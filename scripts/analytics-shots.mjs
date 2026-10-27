// Ticket 17 verification + screenshots (headless Chromium, one-off).
// Seeds analytics data over the public APIs, signs the scratch owner in
// through the real UI (TOTP enroll), opens the widget so the page itself
// beats presence, then captures the analytics page at three widths.
// Usage: node scripts/analytics-shots.mjs <outdir> [port]
import { chromium } from "playwright";
import { TOTP, URI } from "otpauth";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import process from "node:process";

const OUT = process.argv[2] ?? ".scratch/college-website-chat/references/shots-after";
const BASE = `http://127.0.0.1:${process.argv[3] ?? "3123"}`;
const EMAIL = process.env.SHOT_EMAIL ?? "owner@example.edu";
const PASSWORD = process.env.SHOT_PASSWORD ?? "owner-analytics-check-11";
const DB_PATH =
  process.env.CHATBOT_DB ?? ".scratch/college-website-chat/analytics-demo.db";

for (let attempt = 0; ; attempt++) {
  try {
    await fetch(`${BASE}/api/healthz`);
    break;
  } catch {
    if (attempt > 40) throw new Error("server never came up");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// A clean enrollment slate (same as design-shots): wipe any TOTP enrollment
// left by an earlier partial run, since twoFactor.enable rejects while a
// factor is already active.
const db = new DatabaseSync(DB_PATH);
const owner = db.prepare('SELECT id FROM "user" WHERE email = ?').get(EMAIL);
if (owner) {
  db.prepare("DELETE FROM twoFactor WHERE userId = ?").run(owner.id);
  db.prepare('UPDATE "user" SET "twoFactorEnabled" = 0 WHERE id = ?').run(owner.id);
  db.prepare('DELETE FROM "session" WHERE "userId" = ?').run(owner.id);
  console.log("wiped prior enrollment for", EMAIL);
}
db.close();

// --- Seed: two live browsers, three chats, two escalations. ---------------
async function presence(browserId) {
  const response = await fetch(`${BASE}/api/v1/presence`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: BASE },
    body: JSON.stringify({ browserId }),
  });
  if (!response.ok) throw new Error(`presence failed: ${response.status}`);
  console.log("presence beat ok:", await response.json());
}
await presence(crypto.randomUUID());
await presence(crypto.randomUUID());

async function startChat() {
  const response = await fetch(`${BASE}/api/v1/conversations`, { method: "POST" });
  if (!response.ok) throw new Error(`conversation start failed: ${response.status}`);
  return response.json();
}
async function ask(conversation, text) {
  const response = await fetch(`${BASE}/api/v1/conversations/${conversation.id}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${conversation.token}`,
    },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new Error(`ask failed: ${response.status}`);
  const body = await response.json();
  return body.conversation.state;
}
const escalations = [];
for (const [text, expectEscalation] of [
  ["Screenshot seed: how much are the tuition fees?", false],
  ["zzqx screenshot seed unknown topic wonderwall", true],
  ["zzqx another screenshot seed unmatched question", true],
]) {
  const conversation = await startChat();
  const state = await ask(conversation, text);
  console.log("chat", conversation.id.slice(0, 8), "state:", state);
  if (expectEscalation && state !== "awaiting_staff") {
    throw new Error(`expected escalation, got ${state}`);
  }
  if (!expectEscalation && state !== "bot_active") {
    throw new Error(`expected bot answer, got ${state}`);
  }
  escalations.push(conversation);
}

// --- Sign the owner in through the real UI (fresh TOTP enrollment). ------
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => {
  pageErrors.push(String(error).slice(0, 300));
  console.log("PAGE ERROR:", String(error).slice(0, 300));
});
page.on("response", async (response) => {
  if (response.url().includes("/api/staff/analytics")) {
    let preview = "";
    try {
      preview = (await response.text()).slice(0, 120);
    } catch {
      preview = "<body unread>";
    }
    console.log("analytics api:", response.status(), preview);
  }
});
await page.setViewportSize({ width: 1280, height: 800 });

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

// --- Open the widget on the demo page: this browser now beats presence. --
const SKIP_WIDGET = process.env.SKIP_WIDGET === "1";
if (SKIP_WIDGET) console.log("skipping widget step");
if (SKIP_WIDGET) { /* skipped */ } else await page.goto(`${BASE}/demo/wordpress-test-page.html`);
await page.waitForLoadState("domcontentloaded");
const launcher = SKIP_WIDGET ? null : page.locator(".sfcw-launcher");
if (launcher) await launcher.click();
if (launcher) await page.frameLocator(".sfcw-frame").locator('textarea').waitFor({ timeout: 10000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: join(OUT, "after-widget-open-presence.png"), fullPage: false });
console.log("captured after-widget-open-presence");

// --- Analytics page at three widths. --------------------------------------
const WIDTHS = [
  [1280, 800, "desktop"],
  [730, 820, "narrow"],
  [390, 760, "phone"],
];
for (const [width, height, label] of WIDTHS) {
  await page.setViewportSize({ width, height });
  await page.goto(`${BASE}/dashboard/analytics`);
  await page.waitForLoadState("domcontentloaded");
  // A transient first-load failure shows the retry control; use it rather
  // than abandoning the capture.
  for (let tries = 0; tries < 4; tries += 1) {
    const grid = page.locator(String.raw`[class*="statGrid"]`);
    if ((await grid.count()) > 0 && (await grid.isVisible())) {
      break;
    }
    console.log(
      `  [analytics ${label}] try ${tries}: grid=${await grid.count()} error=${await page.locator("p[role=alert]").count()}`,
    );
    const retry = page.getByRole("button", { name: "Try again" });
    if ((await retry.count()) > 0) {
      await retry.click().catch((error) => console.log("  retry click failed:", String(error).slice(0, 120)));
    }
    await page.waitForTimeout(1200);
  }
  try {
    await page.waitForSelector(String.raw`[class*="statGrid"]`, { timeout: 10000 });
  } catch {
    console.log("  body at failure:", (await page.locator("body").innerText()).slice(0, 400));
    console.log("  page errors so far:", pageErrors);
    throw new Error("stat grid never rendered");
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, `after-analytics-${label}.png`), fullPage: true });
  console.log("captured", `after-analytics-${label}`);
}

// Period switch to 30 days, still zero-filled and stable.
await page.setViewportSize({ width: 1280, height: 800 });
await page.getByRole("tab", { name: "Last 30 days" }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: join(OUT, "after-analytics-30d.png"), fullPage: true });
console.log("captured after-analytics-30d");

await browser.close();
console.log("DONE", OUT);
