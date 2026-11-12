// Ticket 15 verification + screenshots (headless Chromium, one-off).
// Exercises the widget's open/close transition (including rapid toggling),
// message arrivals (new vs restored history), and reduced-motion behavior;
// then the dashboard in normal and reduced-motion modes at two widths.
// Usage: node scripts/motion-shots.mjs <outdir> [port]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import process from "node:process";
import {
  enrollAndSignIn,
  freshTotpSlate,
  signInWithTotp,
  waitForServer,
} from "./lib/shot-driver.mjs";

const OUT = process.argv[2] ?? ".scratch/college-website-chat/references/shots-after";
const BASE = `http://127.0.0.1:${process.argv[3] ?? "3125"}`;
const EMAIL = process.env.SHOT_EMAIL ?? "owner@example.edu";
const PASSWORD = process.env.SHOT_PASSWORD ?? "owner-motion-check-31";
const DB_PATH = process.env.CHATBOT_DB ?? ".scratch/college-website-chat/motion-demo.db";

await waitForServer(BASE);

// A service route initializes migrations + seeds; healthz alone does not.
await fetch(`${BASE}/api/v1/topics`);

// Clean enrollment slate (same as the other screenshot drivers).
freshTotpSlate(DB_PATH, EMAIL);

// Provision the screenshot owner if this scratch DB is fresh.
const seedDb = new DatabaseSync(DB_PATH);
const exists = seedDb.prepare('SELECT id FROM "user" WHERE email = ?').get(EMAIL);
seedDb.close();
if (!exists) {
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/bootstrap-owner.ts",
    "--email", EMAIL, "--password", PASSWORD, "--name", "Olive Owner"], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: "inherit",
  });
}

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });

// --- Widget: open/close transition, rapid toggle, arrivals, reduce. ------
{
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });

  // Normal motion first.
  await page.goto(`${BASE}/demo/wordpress-test-page.html`);
  await page.waitForLoadState("domcontentloaded");
  const launcher = page.locator(".sfcw-launcher");
  const frameLoc = page.locator(".sfcw-frame");

  const durations = await frameLoc.evaluate((el) => getComputedStyle(el).transitionDuration);
  console.log("frame transition-duration (normal):", durations);

  // Rapid open/close must land on the last action's state.
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await launcher.click();
    await page.waitForTimeout(40);
    await launcher.click();
    await page.waitForTimeout(40);
  }
  await launcher.click();
  await page.waitForTimeout(400);
  const openState = await frameLoc.evaluate((el) => ({
    hidden: el.hidden,
    hasInClass: el.classList.contains("sfcw-frame-in"),
    opacity: getComputedStyle(el).opacity,
  }));
  console.log("after rapid toggling + final open:", JSON.stringify(openState));
  if (openState.hidden || !openState.hasInClass || openState.opacity !== "1") {
    throw new Error("rapid toggling left the panel in the wrong state");
  }
  await page.screenshot({ path: join(OUT, "after-motion-widget-open.png") });
  console.log("captured after-motion-widget-open");

  // Escape closes; focus returns to the launcher (pre-existing behavior).
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const closedState = await frameLoc.evaluate((el) => ({
    hidden: el.hidden,
    focusIsLauncher: document.activeElement?.classList.contains("sfcw-launcher") ?? false,
  }));
  console.log("after Escape close:", JSON.stringify(closedState));
  if (!closedState.hidden || !closedState.focusIsLauncher) {
    throw new Error("Escape close did not hide the frame and restore launcher focus");
  }
  await launcher.click();
  await page.waitForTimeout(400);

  // A sent message arrives animated, then the flag clears; a page reload's
  // history restore animates nothing.
  const frame = page.frameLocator(".sfcw-frame");
  await frame.locator("textarea").fill("What are the admission requirements");
  await frame.locator("textarea").press("Enter");
  // Inside the 180ms animation window: the flag is up now, gone afterwards.
  await page.waitForTimeout(80);
  const arrivingNow = await frame.locator("[data-arrive]").count();
  await page.waitForTimeout(600);
  const arrivingAfter = await frame.locator("[data-arrive]").count();
  console.log("arriving now/after:", arrivingNow, arrivingAfter);
  if (arrivingNow === 0) throw new Error("new message had no arrival treatment");
  if (arrivingAfter !== 0) throw new Error("arrival flag never cleared");

  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.locator(".sfcw-launcher").click();
  await frame.locator('[role="log"] li').first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(700);
  const restoredArrivals = await frame.locator("[data-arrive]").count();
  console.log("restored-history arrivals:", restoredArrivals);
  if (restoredArrivals !== 0) throw new Error("history restore replayed arrival animations");
  await page.screenshot({ path: join(OUT, "after-motion-widget-transcript.png") });
  console.log("captured after-motion-widget-transcript");

  // Phone width, normal motion (the loader's 480px breakpoint applies).
  await page.setViewportSize({ width: 390, height: 760 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, "after-motion-widget-phone.png") });
  console.log("captured after-motion-widget-phone");
  await page.close();

  // Reduced motion: durations collapse to zero, everything still works. A
  // separate browser: a prior OOPIF-heavy page in the same instance was
  // flaky at resolving this page's frame content.
  const reduceBrowser = await chromium.launch();
  const reduce = await reduceBrowser.newPage({ reducedMotion: "reduce" });
  reduce.on("pageerror", (error) => console.log("REDUCE PAGE ERROR:", String(error).slice(0, 200)));
  reduce.on("console", (message) => {
    if (message.type() === "error") console.log("REDUCE CONSOLE:", message.text().slice(0, 200));
  });
  await reduce.setViewportSize({ width: 1280, height: 800 });
  await reduce.goto(`${BASE}/demo/wordpress-test-page.html`);
  await reduce.waitForLoadState("domcontentloaded");
  await reduce.waitForTimeout(1000);
  await reduce.locator(".sfcw-launcher").click();
  await reduce.waitForTimeout(1500);
  // Frame-object selectors: the frameLocator chain on this page can bind to
  // a stale execution context even when the widget is provably open, while
  // the frame object keeps working.
  const widgetFrame = () => reduce.frames().find((frame) => frame.url().includes("/widget/frame"));
  await widgetFrame().waitForSelector('textarea[placeholder="Type your question"]', { timeout: 30000 });
  const reduceDurations = await reduce
    .locator(".sfcw-frame")
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  console.log("frame transition-duration (reduce):", reduceDurations);
  await reduce.screenshot({ path: join(OUT, "after-motion-widget-reduce.png") });
  console.log("captured after-motion-widget-reduce");
  await widgetFrame().fill("textarea", "What are the admission requirements");
  await widgetFrame().press("textarea", "Enter");
  await widgetFrame().waitForSelector('text="What are the admission requirements"', { timeout: 15000 });
  console.log("reduced-motion send still works");
  await reduce.close();
  await reduceBrowser.close();
}

// --- Dashboard: normal + reduced at desktop and phone. --------------------
{
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("PAGE ERROR:", String(error).slice(0, 200)));
  await page.setViewportSize({ width: 1280, height: 800 });
  const totp = await enrollAndSignIn(page, BASE, EMAIL, PASSWORD);
  console.log("signed in");

  const buttonDuration = await page
    .locator("button")
    .first()
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  console.log("dashboard button transition (normal):", buttonDuration);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, "after-motion-dashboard-desktop.png"), fullPage: true });
  console.log("captured after-motion-dashboard-desktop");

  await page.setViewportSize({ width: 390, height: 760 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, "after-motion-dashboard-phone.png"), fullPage: true });
  console.log("captured after-motion-dashboard-phone");
  await context.close();

  // Reduced motion dashboard: durations zero, layout identical.
  const reduceContext = await browser.newContext({ reducedMotion: "reduce" });
  const reducePage = await reduceContext.newPage();
  await reducePage.setViewportSize({ width: 1280, height: 800 });
  await signInWithTotp(reducePage, BASE, EMAIL, PASSWORD, totp);
  const reduceButton = await reducePage
    .locator("button")
    .first()
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  console.log("dashboard button transition (reduce):", reduceButton);
  await reducePage.waitForTimeout(400);
  await reducePage.screenshot({ path: join(OUT, "after-motion-dashboard-reduce.png"), fullPage: true });
  console.log("captured after-motion-dashboard-reduce");
  await reducePage.setViewportSize({ width: 390, height: 760 });
  await reducePage.waitForTimeout(400);
  await reducePage.screenshot({ path: join(OUT, "after-motion-dashboard-phone-reduce.png"), fullPage: true });
  console.log("captured after-motion-dashboard-phone-reduce");
  await reduceContext.close();
}

await browser.close();
console.log("DONE", OUT);
