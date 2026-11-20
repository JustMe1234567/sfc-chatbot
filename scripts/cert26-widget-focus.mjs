// Ticket 26 certification (headless Chromium, one-off): keyboard focus on
// widget open. Drives the real widget on the demo page — a mouse open puts
// focus on the deliberate target with NO :focus-visible ring (the contact
// gate routes the first open to the close button), passing the gate hands
// focus to the composer, Escape and launcher-click closes return focus to
// the launcher, a keyboard open shows the ring and lands on the composer,
// and reopening refocuses the composer each time. Usage:
// node scripts/cert26-widget-focus.mjs <outdir> [port]
// Dev-mode only (ticket 78): under a production build the ticket-76 embed
// allowlist denies the loopback demo origin — the probe below fails fast.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { assertDemoOriginEmbeddable } from "./lib/shot-driver.mjs";

const OUT =
  process.argv[2] ?? ".scratch/college-website-chat/references/ticket26";
mkdirSync(OUT, { recursive: true });
const BASE = `http://127.0.0.1:${process.argv[3] ?? "3232"}`;

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
await assertDemoOriginEmbeddable(BASE);

const LAUNCHER = "Chat with Springfield College";
const CLOSE = "Close chat";
const COMPOSER_ID = "sfcw-question";

function assert(condition, message) {
  if (!condition) {
    throw new Error(`cert 26 FAILED: ${message}`);
  }
  console.log(`ok: ${message}`);
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${BASE}/demo/wordpress-test-page.html`);
await page.waitForSelector(".sfcw-launcher");

// The widget iframe lives for the page's life; its document hydrates in the
// background and asks the loader for the panel state (ticket 61). On a dev
// server the first navigation can still be committing, so poll for it.
async function waitForWidgetFrame() {
  for (let attempt = 0; ; attempt++) {
    const frame = page.frames().find((candidate) => candidate.url().includes("/widget/frame"));
    if (frame) return frame;
    if (attempt > 100) throw new Error("widget frame never appeared");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function widgetFrame() {
  const frame = page.frames().find((candidate) => candidate.url().includes("/widget/frame"));
  if (!frame) throw new Error("widget frame never appeared");
  return frame;
}

async function activeInside() {
  return widgetFrame().evaluate(() => {
    const el = document.activeElement;
    return {
      id: el?.id ?? "",
      label: el?.getAttribute("aria-label") ?? "",
      ring: el instanceof Element ? el.matches(":focus-visible") : false,
    };
  });
}

// The frame holds focus only once the widget app has hydrated and run the
// open handoff, and on the hosted-store dev server every Postgres roundtrip
// costs an RTT, so that can land well after `.sfcw-frame-in` appears
// (ticket 97: the direct assertion raced it deterministically there). Poll
// for the expected focus state the way waitForWidgetFrame polls for the
// frame: a slow-but-correct server passes, and a focus target that never
// becomes the expected one still fails with the same message.
async function waitForFocusInside(match, message) {
  for (let attempt = 0; ; attempt++) {
    const inside = await activeInside();
    if (match(inside)) return inside;
    if (attempt > 40) throw new Error(`cert 26 FAILED: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function activeInPage() {
  return page.evaluate(() => {
    const el = document.activeElement;
    return {
      launcher: el instanceof Element && el.classList.contains("sfcw-launcher"),
      label: el?.getAttribute("aria-label") ?? "",
    };
  });
}

// 1. Mouse open: the fresh contact gate means the composer does not exist
// yet, so the deliberate target is the always-present close button — and a
// mouse open must NOT light the ring.
await page.getByRole("button", { name: LAUNCHER }).click();
await page.waitForSelector(".sfcw-frame-in");
await waitForWidgetFrame();
let inside = await waitForFocusInside(
  (state) => state.label === CLOSE,
  "mouse open with the contact gate focuses the close button",
);
assert(inside.label === CLOSE, "mouse open with the contact gate focuses the close button");
assert(inside.ring === false, "mouse open shows no :focus-visible ring");
await page.screenshot({ path: join(OUT, "cert26-mouse-open.png") });

// 2. Passing the gate hands focus to the composer (existing ticket-66 flow).
await widgetFrame().locator("#sfcw-name").fill("Jane Doe");
await widgetFrame().locator("#sfcw-email").fill("jane.doe@example.org");
await widgetFrame().locator("#sfcw-phone").fill("(555) 555-0100");
await widgetFrame().getByRole("button", { name: "Start chat" }).click();
await widgetFrame().locator(`#${COMPOSER_ID}`).waitFor();
await new Promise((resolve) => setTimeout(resolve, 400));
inside = await activeInside();
assert(inside.id === COMPOSER_ID, "after the contact gate the composer holds focus");

// 3. Escape closes and returns focus to the launcher (existing behavior).
await page.keyboard.press("Escape");
await new Promise((resolve) => setTimeout(resolve, 300));
let outside = await activeInPage();
assert(outside.launcher, "Escape close returns focus to the launcher");

// 4. Keyboard reopen: the launcher already holds focus, so Enter opens —
// the composer gets focus again and the ring SHOWS for the keyboard user.
await page.keyboard.press("Enter");
await page.waitForSelector(".sfcw-frame-in");
inside = await activeInside();
assert(inside.id === COMPOSER_ID, "keyboard reopen focuses the composer");
assert(inside.ring === true, "keyboard open shows the :focus-visible ring");
await page.screenshot({ path: join(OUT, "cert26-keyboard-open.png") });

// 5. Launcher click closes: focus returns to the launcher again.
await page.getByRole("button", { name: CLOSE }).click();
await new Promise((resolve) => setTimeout(resolve, 300));
outside = await activeInPage();
assert(outside.launcher, "launcher-click close returns focus to the launcher");

// 6. Mouse reopen: the composer is refocused on every open, ring-free.
await page.getByRole("button", { name: LAUNCHER }).click();
await page.waitForSelector(".sfcw-frame-in");
inside = await activeInside();
assert(inside.id === COMPOSER_ID, "mouse reopen refocuses the composer (not just first load)");
assert(inside.ring === false, "mouse reopen shows no :focus-visible ring");

// 7. Escape close, leaving the host page as we found it.
await page.keyboard.press("Escape");
await new Promise((resolve) => setTimeout(resolve, 300));
outside = await activeInPage();
assert(outside.launcher, "final Escape close returns focus to the launcher");

await browser.close();
console.log("cert 26 PASSED");
