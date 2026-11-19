// Ticket 28 certification (headless Chromium, one-off): dashboard a11y. On a
// production build against a scratch Postgres database (isolated from the
// dev server's data), signs the bootstrapped owner in through the real UI,
// then verifies the two ticket behaviors with
// keyboard-driven interaction: the analytics period switch completes the
// tabs pattern (roving tabindex, arrow keys move selection AND focus with
// wrap, Home/End, one owned panel named by the active tab, and the report
// genuinely reloading per period) and the desk transcript is a polite live
// region whose polled re-render appends a new visitor message without
// navigation. The full manual keyboard-only pass remains the human browser
// phase (box 3).
// Usage: node scripts/cert28-dashboard-a11y.mjs <outdir> [port]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { signIn } from "./lib/shot-driver.mjs";

const OUT =
  process.argv[2] ?? ".scratch/college-website-chat/references/ticket28";
const BASE = `http://127.0.0.1:${process.argv[3] ?? "3234"}`;
const USERNAME = "owner";
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

// Seed a real conversation over the API: the contact-gate create, then a
// question the seeded Fees rule answers, so the desk shows an active chat
// with a transcript and today's analytics carries the chat.
const CONTACT = {
  fullName: "Jane Doe",
  email: "jane.doe@example.org",
  phone: "(555) 010-0199",
};
const createResponse = await fetch(`${BASE}/api/v1/conversations`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(CONTACT),
});
if (!createResponse.ok) throw new Error(`conversation create failed: ${createResponse.status}`);
const conversation = await createResponse.json();
const firstMessage = await fetch(
  `${BASE}/api/v1/conversations/${conversation.id}/messages`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${conversation.token}`,
    },
    body: JSON.stringify({ text: "What are the tuition fees?" }),
  },
);
if (!firstMessage.ok) throw new Error(`first message failed: ${firstMessage.status}`);

async function postVisitorMessage(text) {
  return fetch(`${BASE}/api/v1/conversations/${conversation.id}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${conversation.token}`,
    },
    body: JSON.stringify({ text }),
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

async function shot(name) {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
  console.log("captured", name);
}

// ===========================================================================
// Owner sign-in (scratch db, password-only flow since ticket 82).
// ===========================================================================
await signIn(page, BASE, USERNAME, PASSWORD);

// ===========================================================================
// The analytics period switch: keyboard-only tabs pattern.
// ===========================================================================
await page.goto(`${BASE}/dashboard/analytics`);
await page.waitForLoadState("domcontentloaded");
const tablist = page.locator('[role="tablist"][aria-label="Reporting period"]');
await tablist.waitFor({ timeout: 10000 });

// Keyboard-only: Tab from the top of the document until focus lands on a tab.
let focusedTab = "";
for (let presses = 0; presses < 60; presses++) {
  await page.keyboard.press("Tab");
  focusedTab = await page.evaluate(() => document.activeElement?.id ?? "");
  if (focusedTab.startsWith("analytics-tab-")) break;
}
if (!focusedTab.startsWith("analytics-tab-")) {
  throw new Error(`keyboard never reached the period tabs (landed on: ${focusedTab})`);
}
if (focusedTab !== "analytics-tab-7d") {
  throw new Error(`the roving tabindex did not start on the selected tab: ${focusedTab}`);
}
console.log("ok: the first Tab stop in the tablist is the selected (7d) tab");

async function assertTab(expectedKey, expectedRows) {
  const state = await page.evaluate(() => {
    const active = document.activeElement;
    const selected = document.querySelector('[role="tab"][aria-selected="true"]');
    const panel = document.querySelector("#analytics-panel");
    return {
      focused: active?.id ?? "",
      selected: selected?.id ?? "",
      labelledBy: panel?.getAttribute("aria-labelledby") ?? "",
      controls: selected?.getAttribute("aria-controls") ?? "",
      rows: document.querySelectorAll("#analytics-panel tbody tr").length,
      tabIndex: selected?.getAttribute("tabindex") ?? "",
    };
  });
  if (state.focused !== `analytics-tab-${expectedKey}`) {
    throw new Error(`focus is on ${state.focused}, expected analytics-tab-${expectedKey}`);
  }
  if (state.selected !== state.focused) {
    throw new Error(`aria-selected tab (${state.selected}) is not the focused tab (${state.focused})`);
  }
  if (state.labelledBy !== state.selected) {
    throw new Error(`panel is labelled by ${state.labelledBy}, expected ${state.selected}`);
  }
  if (state.controls !== "analytics-panel") {
    throw new Error(`tab does not control the panel (aria-controls=${state.controls})`);
  }
  if (state.tabIndex !== "0") {
    throw new Error(`the selected tab's roving tabindex is ${state.tabIndex}, expected 0`);
  }
  if (state.rows !== expectedRows) {
    throw new Error(`${expectedKey} report shows ${state.rows} day rows, expected ${expectedRows}`);
  }
}

// ArrowRight: 7d → 30d. The report genuinely reloads: thirty day rows —
// and the arrow path's focus restoration lands once the load settles (the
// tabs' load-time disabled blurs focus; the effect brings it back).
await page.keyboard.press("ArrowRight");
await page.waitForFunction(
  () =>
    document.querySelectorAll("#analytics-panel tbody tr").length === 30 &&
    document.activeElement?.id === "analytics-tab-30d",
  { timeout: 15000 },
);
await assertTab("30d", 30);
console.log("ok: ArrowRight moves selection AND focus to 30d and the report reloads");

// Wrap: 30d → ArrowRight → today (one row; the chat seeded above).
await page.keyboard.press("ArrowRight");
await page.waitForFunction(
  () =>
    document.querySelectorAll("#analytics-panel tbody tr").length === 1 &&
    document.activeElement?.id === "analytics-tab-today",
  { timeout: 15000 },
);
await assertTab("today", 1);
console.log("ok: the selection wraps from the last tab to Today");

// ArrowLeft walks back, Home/End jump.
await page.keyboard.press("ArrowLeft");
await page.waitForFunction(
  () => document.activeElement?.id === "analytics-tab-30d" &&
    document.querySelectorAll("#analytics-panel tbody tr").length === 30,
  { timeout: 15000 },
);
await assertTab("30d", 30);
await page.keyboard.press("Home");
await page.waitForFunction(
  () =>
    document.activeElement?.id === "analytics-tab-today" &&
    document.querySelectorAll("#analytics-panel tbody tr").length === 1,
  { timeout: 15000 },
);
await assertTab("today", 1);
await page.keyboard.press("End");
await page.waitForFunction(
  () => document.activeElement?.id === "analytics-tab-30d" &&
    document.querySelectorAll("#analytics-panel tbody tr").length === 30,
  { timeout: 15000 },
);
await assertTab("30d", 30);
console.log("ok: ArrowLeft steps back; Home and End jump to the ends");
await shot("28-analytics-tabs");

// ===========================================================================
// The desk transcript: polite live region fed by the authorized poll.
// ===========================================================================
await page.goto(`${BASE}/dashboard/inbox`);
await page.waitForLoadState("domcontentloaded");
const list = page.getByRole("navigation", { name: "Conversation list" });
await list.waitFor({ timeout: 10000 });
await page.waitForTimeout(1500);
const row = list.getByRole("link").filter({ hasText: "Jane Doe" }).first();
if ((await row.count()) === 0) {
  throw new Error("the seeded conversation is not on the desk");
}

// Keyboard-only selection: focus the row link and press Enter.
await row.focus();
await page.keyboard.press("Enter");
await page.waitForURL(/\/dashboard\/inbox\//, { timeout: 15000 });
const transcript = page.locator('[role="log"][aria-live="polite"][aria-label="Messages"]');
await transcript.waitFor({ timeout: 10000 });
const transcriptMeta = await transcript.evaluate((el) => ({
  role: el.getAttribute("role"),
  live: el.getAttribute("aria-live"),
  tabindex: el.getAttribute("tabindex"),
}));
if (transcriptMeta.tabindex === null) {
  throw new Error("the transcript is not keyboard-reachable (no tabindex)");
}
await transcript.getByText("$3,500").waitFor({ timeout: 10000 });
console.log("ok: the transcript is a labelled, focusable, polite live region");

// A second visitor message arrives through the poll: its node appends into
// the live region without navigation — what role="log" announces politely.
// (An unknown question also draws the bot's ticket-37 answer after it, so
// presence in the log, not tail position, is the assertion.)
await postVisitorMessage("Cert 28: does the fees page cover scholarships?");
await transcript.getByText("does the fees page cover scholarships?").waitFor({
  timeout: 15000,
});
await shot("28-desk-transcript");
console.log("ok: a polled new visitor message appends into the polite live region");

if (pageErrors.length > 0) {
  throw new Error(`page errors during the run: ${pageErrors.join(" | ")}`);
}
await browser.close();
console.log("ticket 28 checks passed (automated portion; the full manual");
console.log("keyboard-only pass remains for the human browser phase);");
console.log("screenshots in", OUT);
