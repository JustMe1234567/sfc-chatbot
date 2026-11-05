// Ticket 59 verification (headless Chromium): measured history-request
// counts in the ticket's four states, plus the reopen-reply and presence
// checks. Run against a production build started with CHATBOT_DB pointing
// at the SAME absolute database path passed here, then record the printed
// JSON in the ticket. `before` mode measures the old unconditional 3-second
// poller (any build without ticket 59); `after` mode (default) measures the
// gated poller. Usage:
//   node scripts/history-polling-shots.mjs [before] [port]
import { chromium } from "playwright";
import { DatabaseSync } from "node:sqlite";
import process from "node:process";

const MODE = process.argv[2] === "before" ? "before" : "after";
const PORT = process.argv[3] ?? "3218";
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = process.env.CHATBOT_DB ?? ".scratch/college-website-chat/polling59.db";

for (let attempt = 0; ; attempt++) {
  try {
    await fetch(`${BASE}/api/healthz`);
    break;
  } catch {
    if (attempt > 60) throw new Error("server never came up");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
const warm = await fetch(`${BASE}/api/v1/topics`);
if (!warm.ok) throw new Error(`topics fetch failed: ${warm.status}`);

const db = new DatabaseSync(DB_PATH);

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

// Every authorized history GET (never the POST that sends a question).
function watchRequests() {
  const stamps = [];
  const onRequest = (request) => {
    if (
      request.method() === "GET" &&
      /\/api\/v1\/conversations\/[^/]+\/messages/.test(request.url())
    ) {
      stamps.push(Date.now());
    }
  };
  page.on("request", onRequest);
  return {
    stamps,
    reset() {
      stamps.length = 0;
    },
    count() {
      return stamps.length;
    },
    detach() {
      page.off("request", onRequest);
    },
  };
}
const requests = watchRequests();

const frame = page.frameLocator(".sfcw-frame");

async function openDemo() {
  await page.goto(`${BASE}/demo/wordpress-test-page.html`);
  await page.waitForLoadState("domcontentloaded");
  await page.locator(".sfcw-launcher").waitFor({ timeout: 10000 });
}

// The frame document mirrors the host page's visibility state, so the
// override must land in both documents. The frame document is reached
// through the parent's contentDocument (same origin on the demo page) —
// cross-origin frame.evaluate can bind to a stale OOPIF execution context
// and silently no-op (the ticket-15 lesson). The frame's poller learns
// about host visibility from the loader's `sfcw:state` message, so the
// transition itself is driven by posting exactly what the loader posts on
// a real visibilitychange.
async function setVisibility(value) {
  await page.evaluate((visible) => {
    const applyTo = (doc) => {
      Object.defineProperty(doc, "visibilityState", {
        get: () => (visible ? "visible" : "hidden"),
        configurable: true,
      });
    };
    applyTo(document);
    const frame = document.querySelector(".sfcw-frame");
    if (frame?.contentDocument) {
      applyTo(frame.contentDocument);
    }
    frame.contentWindow.postMessage(
      { type: "sfcw:state", open: false, visible },
      location.origin,
    );
  }, value === "visible");
}

async function openPanel() {
  await page.locator(".sfcw-launcher").click();
  await frame.locator('textarea[placeholder="Type your question"]').waitFor({ timeout: 10000 });
}

async function closePanel() {
  await page.locator(".sfcw-launcher").click();
  await page.waitForTimeout(300);
}

// --- Visitor asks one question so a session (and conversation) exists. -----
await openDemo();
await openPanel();
await frame.locator('textarea[placeholder="Type your question"]').fill("How much are the tuition fees");
await frame.getByRole("button", { name: /Send/ }).click();
await frame.getByText("Tuition for most programs").waitFor({ timeout: 15000 });
const conversation = db
  .prepare("SELECT id, visitor_last_seen_at FROM conversations ORDER BY created_at DESC, rowid DESC LIMIT 1")
  .get();
if (!conversation?.id) throw new Error("the visitor question created no conversation");
requests.reset();
console.log("setup done; conversation", conversation.id);

const results = { mode: MODE };

// --- State 1: visible + open (panel up). ------------------------------------
requests.reset();
await page.waitForTimeout(7000);
results.visibleOpenPer7s = requests.count();
if (MODE === "after") {
  if (results.visibleOpenPer7s < 1 || results.visibleOpenPer7s > 3) {
    throw new Error(`open/visible cadence unexpected: ${results.visibleOpenPer7s} requests in 7s`);
  }
}

// --- State 2: visible + closed (panel hidden, iframe stays mounted). --------
await closePanel();
requests.reset();
await page.waitForTimeout(35_000);
results.visibleClosedPer35s = requests.count();
if (MODE === "after" && results.visibleClosedPer35s !== 1) {
  throw new Error(`closed-panel cadence unexpected: ${results.visibleClosedPer35s} requests in 35s (want 1)`);
}

// Presence stayed alive through that window (below the 60s departure clock).
const seenAfterClosed = db
  .prepare("SELECT visitor_last_seen_at FROM conversations WHERE id = ?")
  .get(conversation.id)?.visitor_last_seen_at;
const seenAgeMs = Date.now() - new Date(seenAfterClosed).getTime();
results.closedPanelPresenceAgeSeconds = Math.round(seenAgeMs / 1000);
if (seenAgeMs > 60_000) {
  throw new Error(`presence went stale behind the closed panel: ${seenAfterClosed}`);
}

// --- State 3: hidden host page. ---------------------------------------------
await setVisibility("hidden");
requests.reset();
await page.waitForTimeout(7000);
results.hiddenPer7s = requests.count();
// Back to visible: one immediate catch-up fetch, cadence resumes after.
await setVisibility("visible");
await page.waitForTimeout(1500);
results.immediateFetchOnVisible = requests.count();
if (MODE === "after") {
  if (results.hiddenPer7s !== 0) {
    throw new Error(`hidden page still polled: ${results.hiddenPer7s} requests in 7s`);
  }
  if (results.immediateFetchOnVisible !== 1) {
    throw new Error(`visibility return did not fetch exactly once: ${results.immediateFetchOnVisible}`);
  }
}

// --- A staff reply appears after reopening the panel. -----------------------
const now = new Date().toISOString();
db.prepare(
  "INSERT INTO messages (id, conversation_id, role, text, link, choices, created_at) VALUES (?, ?, 'staff', ?, NULL, NULL, ?)",
).run(crypto.randomUUID(), conversation.id, "Staff reply for the reopen check.", now);
await openPanel();
await frame.getByText("Staff reply for the reopen check.").waitFor({ timeout: 8000 });
results.reopenShowsStaffReply = true;

// --- State 4: a fresh visitor with no session polls nothing. ----------------
const conversationsBefore = db.prepare("SELECT COUNT(*) AS n FROM conversations").get().n;
const freshContext = await browser.newContext();
const freshPage = await freshContext.newPage();
// Move the watcher onto the fresh page for its own count.
requests.detach();
const freshStamps = [];
const freshWatcher = (request) => {
  if (
    request.method() === "GET" &&
    /\/api\/v1\/conversations\/[^/]+\/messages/.test(request.url())
  ) {
    freshStamps.push(Date.now());
  }
};
freshPage.on("request", freshWatcher);
await freshPage.goto(`${BASE}/demo/wordpress-test-page.html`);
await freshPage.waitForLoadState("domcontentloaded");
await freshPage.locator(".sfcw-launcher").click();
await freshPage
  .frames()
  .find((f) => f.url().includes("/widget/frame"))
  .locator('textarea[placeholder="Type your question"]')
  .waitFor({ timeout: 10000 });
await freshPage.waitForTimeout(7000);
results.noSessionPer7s = freshStamps.length;
const conversationsAfter = db.prepare("SELECT COUNT(*) AS n FROM conversations").get().n;
results.noSessionCreatedConversation = conversationsAfter - conversationsBefore;
if (MODE === "after" && (results.noSessionPer7s !== 0 || results.noSessionCreatedConversation !== 0)) {
  throw new Error(
    `a sessionless visitor polled ${results.noSessionPer7s} times and created ${results.noSessionCreatedConversation} conversation(s)`,
  );
}
await freshContext.close();

console.log("RESULTS " + JSON.stringify(results));
await browser.close();
console.log(`ticket 59 ${MODE} measurements complete`);
