// Ticket 44 verification (headless Chromium, one-off): the desk's status
// treatments and the notification sound. Signs the owner in through the real
// UI against a scratch database, seeds conversations
// through the public API, and counts chimes with a fake AudioContext whose
// state is controllable — so the sound matrix (one cue per event, silence on
// polling, burst coalescing, muting, reload/second-view dedup, and the
// autoplay-blocked late cue) is asserted by number, not by ear.
// Usage: node scripts/desk-status-shots.mjs <outdir> [port]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import process from "node:process";
import { signIn } from "./lib/shot-driver.mjs";

const OUT = process.argv[2] ?? ".scratch/college-website-chat/references/shots-desk-status";
const BASE = `http://127.0.0.1:${process.argv[3] ?? "3211"}`;
const DB_PATH = process.env.CHATBOT_DB ?? ".scratch/college-website-chat/desk-demo.db";
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

// Any chatbot route initializes the service singleton (migrations + seed
// rules); healthz alone does not — and the wipe below needs the tables.
const topicsResponse = await fetch(`${BASE}/api/v1/topics`);
if (!topicsResponse.ok) throw new Error(`topics fetch failed: ${topicsResponse.status}`);

// No enrollment wipe (ticket 80): staff credentials live in hosted Supabase
// Auth, not a store table, so the sign-in below requires a freshly
// bootstrapped owner.

async function startChat() {
  const response = await fetch(`${BASE}/api/v1/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Ticket 66: every new chat starts with the required contact details.
    body: JSON.stringify({ fullName: "Jane Doe", email: "jane.doe@example.org", phone: "(555) 010-0199" }),
  });
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
  return (await response.json()).conversation.state;
}

// The fake AudioContext: each chime starts exactly two oscillator notes, so
// `oscStarts / 2` counts chimes exactly. `state` decides autoplay behavior;
// with unlockOnResume the first gesture (resume call) flips it to running,
// like a real browser.
function audioProbeScript(state, unlockOnResume) {
  return `
  (() => {
    // The count lives in sessionStorage: this tab's tally survives the
    // reloads and navigations of the run, while a second view still starts
    // from zero. Storage can be off-limits (about:blank) — degrade to zero.
    let persisted = 0;
    try {
      persisted = Number(sessionStorage.getItem("__probeOsc") ?? "0") || 0;
    } catch {}
    const probe = {
      oscStarts: persisted,
      resumes: 0,
      state: ${JSON.stringify(state)},
      unlockOnResume: ${unlockOnResume},
    };
    window.__audioProbe = probe;
    class FakeAudioContext {
      constructor() {
        this.state = probe.state;
        this.currentTime = 0;
        this.destination = {};
      }
      createGain() {
        return {
          gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {},
        };
      }
      createOscillator() {
        return {
          type: "",
          frequency: { value: 0 },
          connect() {},
          start() {
            probe.oscStarts += 1;
            try {
              sessionStorage.setItem("__probeOsc", String(probe.oscStarts));
            } catch {}
          },
          stop() {},
        };
      }
      resume() {
        probe.resumes += 1;
        if (probe.unlockOnResume) probe.state = "running";
        return Promise.resolve();
      }
    }
    window.AudioContext = FakeAudioContext;
  })();
`;
}

const browser = await chromium.launch();
const context = await browser.newContext();
await context.addInitScript(audioProbeScript("running", false));
const page = await context.newPage();
const pageErrors = [];
for (const target of [page]) {
  target.on("pageerror", (error) => {
    pageErrors.push(String(error).slice(0, 300));
    console.log("PAGE ERROR:", String(error).slice(0, 300));
  });
}
await page.setViewportSize({ width: 1280, height: 800 });

// --- Sign the owner in through the real UI (password-only since 82). ------
await signIn(page, BASE, USERNAME, PASSWORD);

const chimes = (target = page) =>
  target.evaluate(() => Number(sessionStorage.getItem("__probeOsc") ?? "0") / 2);
const expectChimes = async (expected, label, target = page) => {
  // The settle must outlast the 400ms burst window so a scheduled-but-
  // unexecuted cue cannot masquerade as silence.
  if (target === page) await page.waitForTimeout(900);
  const actual = await chimes(target);
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected} chimes, heard ${actual}`);
  }
  console.log(`ok: ${label} (chimes=${actual})`);
};

// --- Empty desk: the toggle is there, nothing has ever sounded. -----------
const toggle = page.getByRole("button", { name: /Notification sounds/ });
await toggle.waitFor({ timeout: 10000 });
if ((await toggle.getAttribute("aria-pressed")) !== "true") {
  throw new Error("sound toggle does not start unmuted");
}
await expectChimes(0, "empty desk never sounds");
mkdirSync(OUT, { recursive: true });

// --- A visitor question is attention until staff read it (ticket 12): the
// first sighting cues once, even while the bot is still answering. ---------
const botChat = await startChat();
if ((await ask(botChat, "Screenshot seed: how much are the tuition fees?")) !== "bot_active") {
  throw new Error("expected a bot answer");
}
await page.waitForTimeout(5000);
await expectChimes(1, "one chime for a fresh visitor message needing attention");

// --- Escalation: one more chime for the needs-human event. -----------------
const waiting = await startChat();
if ((await ask(waiting, "Screenshot seed: I want to speak to a human.")) !== "awaiting_staff") {
  throw new Error("expected an escalation");
}
await page.waitForTimeout(5000);
await expectChimes(2, "one chime when a chat newly needs a human");

// --- Claimed chat with another visitor message: one more chime. ------------
const claimed = await startChat();
if ((await ask(claimed, "Screenshot seed: claim test, please let me speak to a human.")) !== "awaiting_staff") {
  throw new Error("expected an escalation");
}
await page.evaluate(async (id) => {
  const response = await fetch(`/api/staff/conversations/${id}/claim`, { method: "POST" });
  if (!response.ok) throw new Error(`claim failed: ${response.status}`);
}, claimed.id);
await ask(claimed, "One more thing about the form, though.");
await page.waitForTimeout(5000);
await expectChimes(3, "one chime per new attention episode, bursts included");

// Viewing the bot chat clears its alert: the row keeps its state text but
// reads Active now, and no cue fires for the viewing itself. The row preview
// shows the last message — the bot's answer — not the visitor's question.
const list = page.getByRole("navigation", { name: "Conversation list" });
await Promise.all([
  page.waitForURL(/\/dashboard\/inbox\//, { timeout: 15000 }),
  list.getByRole("link").filter({ hasText: "3,500 per semester" }).first().click(),
]);
console.log("ok: transcript view opened for the bot chat at", page.url());
// The back link is a mobile-only affordance (ticket 13 hides .deskBack at
// desktop widths), so the script returns via the list tab instead.
await page.goto(`${BASE}/dashboard/inbox`);
await list.waitFor({ timeout: 10000 });
await page.waitForTimeout(3500);

// --- Status treatments across the desk surfaces. ---------------------------
await page.goto(`${BASE}/dashboard/inbox`);
await list.waitFor({ timeout: 10000 });
await expectChimes(3, "viewing a transcript and reopening the desk stays silent");
const needsHumanDots = await list.getByRole("img", { name: "Needs human" }).count();
const attentionDots = await list.getByRole("img", { name: "New message" }).count();
const activeDots = await list.getByRole("img", { name: "Active" }).count();
if (needsHumanDots !== 1 || attentionDots !== 1 || activeDots !== 1) {
  throw new Error(
    `expected one dot per tier, got needs_human=${needsHumanDots} attention=${attentionDots} active=${activeDots}`,
  );
}
if ((await list.getByText("Needs human", { exact: true }).count()) < 1) {
  throw new Error("needs-human rows must say it in text, not color alone");
}
if ((await list.getByText("New message", { exact: true }).count()) < 1) {
  throw new Error("attention rows must say it in text, not color alone");
}
// The gold tab count is the attention tier only (here: the claimed chat);
// the escalation is counted by Incoming's needs-human pill instead.
if ((await list.getByText("1 new", { exact: true }).count()) !== 1) {
  throw new Error("the tab count must carry the attention treatment");
}
if ((await list.getByText("1 waiting", { exact: true }).count()) !== 1) {
  throw new Error("the Incoming heading must carry the needs-human count");
}
console.log("ok: dots, badges, and tier counts present on every desk surface");
// Polling never repeats an episode's cue.
await page.waitForTimeout(7000);
await expectChimes(3, "polling and re-render never repeat a cue");

// The selected header shares the tier mapping; viewing clears the alert but
// the row keeps its needs-human treatment (it is still unclaimed).
await Promise.all([
  page.waitForURL(/\/dashboard\/inbox\//, { timeout: 15000 }),
  list.getByRole("link").filter({ hasText: "Needs human" }).first().click(),
]);
console.log("ok: opened the waiting conversation at", page.url());
const pane = page.getByRole("region", { name: "Selected conversation" });
await pane.getByText("Needs human").first().waitFor({ timeout: 10000 });
console.log("ok: selected header shows the needs-human tier chip");
await page.screenshot({ path: join(OUT, "desk-status-selected-needs-human.png"), fullPage: true });
await page.goto(`${BASE}/dashboard/inbox`);
await list.waitFor({ timeout: 10000 });
await page.screenshot({ path: join(OUT, "desk-status-list.png"), fullPage: true });

// --- History rows are the archive: no status treatment at all. -------------
{
  const db = new DatabaseSync(DB_PATH);
  const aged = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  db.prepare("UPDATE conversations SET last_activity_at = ? WHERE state = 'bot_active'").run(aged);
  db.close();
}
// The History TAB must reach the archive (ticket 48): clicking it shows the
// History heading and rows, not the live desk again.
await page.goto(`${BASE}/dashboard/inbox`);
await list.waitFor({ timeout: 10000 });
await page.getByRole("link", { name: "History" }).click();
await page.getByRole("heading", { name: "History" }).waitFor({ timeout: 10000 });
console.log("ok: the History tab reaches the archive");
const historyDots = await page.getByRole("img").count();
const historyBadges =
  (await page.getByText("Needs human", { exact: true }).count()) +
  (await page.getByText("New message", { exact: true }).count());
if (historyDots !== 0 || historyBadges !== 0) {
  throw new Error(
    `history rows must carry no status treatment, got dots=${historyDots} badges=${historyBadges}`,
  );
}
// A history conversation's back link targets the archive (ticket 48). The
// back link is a mobile-only affordance (hidden at desktop widths), so its
// href is asserted rather than clicked. Rows are the links that contain a
// timestamp; the two tabs do not.
await list.locator("a:has(time)").first().click();
const backLink = page.locator('[class*="deskBack"]');
await backLink.waitFor({ state: "attached", timeout: 10000 });
if ((await backLink.getAttribute("href")) !== "/dashboard/inbox/history") {
  throw new Error("a history conversation's back link must return to the archive");
}
console.log("ok: a history conversation's back link targets the archive");
console.log("ok: history rows keep their state text and no tier treatment");
await page.screenshot({ path: join(OUT, "desk-status-history.png"), fullPage: true });
await page.goto(`${BASE}/dashboard/inbox`);
await list.waitFor({ timeout: 10000 });

// --- Muting silences cues and persists; visuals stay. ----------------------
await toggle.click();
if ((await toggle.getAttribute("aria-pressed")) !== "false") {
  throw new Error("toggling must mute the sound");
}
if ((await page.evaluate(() => localStorage.getItem("sfc-dashboard-sound-muted"))) !== "1") {
  throw new Error("the mute preference must persist locally");
}
await ask(claimed, "Another visitor message while staff is muted.");
await page.waitForTimeout(5000);
await expectChimes(3, "muting suppresses the cue for a fresh event");
await page.screenshot({ path: join(OUT, "desk-status-muted.png"), fullPage: false });

await toggle.click();
if ((await toggle.getAttribute("aria-pressed")) !== "true") {
  throw new Error("toggling again must unmute");
}

// --- Reload: seen episodes stay quiet. -------------------------------------
await page.reload();
await list.waitFor({ timeout: 10000 });
if ((await page.evaluate(() => localStorage.getItem("sfc-dashboard-sound-muted"))) !== "0") {
  throw new Error("the unmuted preference must survive a reload");
}
await page.waitForTimeout(3000);
await expectChimes(3, "reloading never re-blasts seen episodes");

// --- A second view: shared identity, exactly one tab ever cues. ------------
const second = await context.newPage();
second.on("pageerror", (error) => {
  pageErrors.push(String(error).slice(0, 300));
  console.log("PAGE ERROR (2nd):", String(error).slice(0, 300));
});
await second.setViewportSize({ width: 1280, height: 800 });
await second.goto(`${BASE}/dashboard/inbox`);
await second.getByRole("navigation", { name: "Conversation list" }).waitFor({ timeout: 10000 });
await second.waitForTimeout(3000);
await expectChimes(3, "a second view of the same desk stays silent for seen events");
const secondProbe = await chimes(second);
if (secondProbe !== 0) {
  throw new Error(`the second view itself must never cue seen events, heard ${secondProbe}`);
}
// The burst detour below needs only one live watcher: a second open view
// would consume the burst events in its own polls.
await second.close();

// --- A burst of two events is one restrained cue, not two. -----------------
// Detour so neither view consumes them: both events then arrive in the
// first snapshot after the watcher remounts, guaranteeing one batch.
await page.goto("about:blank");
const burstOne = await startChat();
if ((await ask(burstOne, "Screenshot seed: burst one, let me speak to a human.")) !== "awaiting_staff") {
  throw new Error("expected an escalation");
}
const burstTwo = await startChat();
if ((await ask(burstTwo, "Screenshot seed: burst two, let me speak to a human.")) !== "awaiting_staff") {
  throw new Error("expected an escalation");
}
await page.goto(`${BASE}/dashboard/inbox`);
await list.waitFor({ timeout: 10000 });
await page.waitForTimeout(3000);
await expectChimes(4, "a burst of two attention events coalesces into one cue");

// --- A fresh event with both views open cues exactly one of them. ----------
const secondView = await context.newPage();
secondView.on("pageerror", (error) => {
  pageErrors.push(String(error).slice(0, 300));
  console.log("PAGE ERROR (2nd):", String(error).slice(0, 300));
});
await secondView.setViewportSize({ width: 1280, height: 800 });
await secondView.goto(`${BASE}/dashboard/inbox`);
await secondView
  .getByRole("navigation", { name: "Conversation list" })
  .waitFor({ timeout: 10000 });
await secondView.waitForTimeout(1000);
const third = await startChat();
if ((await ask(third, "Screenshot seed: I need to speak to a human now.")) !== "awaiting_staff") {
  throw new Error("expected an escalation");
}
await page.waitForTimeout(5000);
const page1Chimes = await chimes(page);
const page2Chimes = await chimes(secondView);
if (page1Chimes + page2Chimes !== 5) {
  throw new Error(
    `a fresh event must cue exactly one view, heard ${page1Chimes}+${page2Chimes}`,
  );
}
console.log(`ok: fresh event cued exactly one view (chimes=${page1Chimes}+${page2Chimes})`);
await secondView.close();

// --- Autoplay-blocked browser: quiet until the first interaction. ----------
const blocked = await browser.newContext();
await blocked.addInitScript(audioProbeScript("suspended", true));
const blockedPage = await blocked.newPage();
blockedPage.on("pageerror", (error) => {
  pageErrors.push(String(error).slice(0, 300));
  console.log("PAGE ERROR (blocked):", String(error).slice(0, 300));
});
await blockedPage.setViewportSize({ width: 1280, height: 800 });
const heldChat = await startChat();
if ((await ask(heldChat, "Screenshot seed: autoplay check, let me speak to a human.")) !== "awaiting_staff") {
  throw new Error("expected an escalation");
}
// A fresh context means a fresh session: sign the owner in again.
await signIn(blockedPage, BASE, USERNAME, PASSWORD);
await blockedPage
  .getByRole("navigation", { name: "Conversation list" })
  .waitFor({ timeout: 10000 });
await blockedPage.waitForTimeout(4000);
let blockedChimes = await chimes(blockedPage);
if (blockedChimes !== 0) {
  throw new Error(`audio must not play before a gesture, heard ${blockedChimes}`);
}
await blockedPage.waitForTimeout(4000);
blockedChimes = await chimes(blockedPage);
if (blockedChimes !== 0) {
  throw new Error(`a blocked cue must not loop while polls continue, heard ${blockedChimes}`);
}
await blockedPage.keyboard.press("Shift");
await blockedPage.waitForTimeout(1500);
blockedChimes = await chimes(blockedPage);
if (blockedChimes !== 1) {
  throw new Error(`the first interaction must unlock one late cue, heard ${blockedChimes}`);
}
console.log("ok: autoplay-blocked audio enables after the first interaction (one late cue)");
await blocked.close();

if (pageErrors.length > 0) {
  throw new Error(`page errors during the run: ${pageErrors.join(" | ")}`);
}
await browser.close();
console.log("ticket 44 desk-status checks passed;");
console.log("screenshots in", OUT);
