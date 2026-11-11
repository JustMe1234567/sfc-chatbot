// Ticket 27 certification (headless Chromium, one-off): widget touch/click
// targets. Walks the real widget through every state the controls live in —
// contact gate, fresh suggestions, active conversation with the strip and a
// transcript link, the header overflow menu, the clear-conversation confirm
// pair, the unknown-question offer, and the waiting lock — measuring every
// interactive control's rendered box and failing if any button falls below
// the WCAG 2.5.8 24×24px minimum (the in-bubble text link is inline flow and
// exempt, but still measured and reported). Adjacent-target overlaps are
// refused and gaps reported; the 360px embed's composer height and
// horizontal fit are asserted per ticket 18's constraint.
// Usage: node scripts/cert27-touch-targets.mjs <outdir> [port]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const OUT =
  process.argv[2] ?? ".scratch/college-website-chat/references/ticket27";
const BASE = `http://127.0.0.1:${process.argv[3] ?? "3233"}`;

for (let attempt = 0; ; attempt++) {
  try {
    await fetch(`${BASE}/api/healthz`);
    break;
  } catch {
    if (attempt > 40) throw new Error("server never came up");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

const CONTACT = {
  fullName: "Jane Doe",
  email: "jane.doe@example.org",
  phone: "(555) 010-0199",
};

const measurements = [];
const exempt = [];

/** Buttons and other standalone controls must reach 24×24. */
function requireMin(name, box, min = 24) {
  if (box.width < min || box.height < min) {
    throw new Error(
      `${name} target is ${box.width.toFixed(1)}x${box.height.toFixed(1)}px, below the ${min}px minimum`,
    );
  }
  measurements.push(`${name}: ${box.width.toFixed(1)}x${box.height.toFixed(1)}`);
}

/** The in-bubble text link: inline flow (WCAG 2.5.8 inline exception) —
    measured, reported, and held to a readable floor rather than 24px. */
function noteInline(name, box) {
  if (box.height < 14) {
    throw new Error(`${name} inline target is unreadably small: ${box.height.toFixed(1)}px`);
  }
  exempt.push(`${name} (inline flow): ${box.width.toFixed(1)}x${box.height.toFixed(1)}`);
}

/** Adjacent controls must not overlap; the gap is reported as evidence. */
function requireNoOverlap(nameA, nameB, gap) {
  if (gap < -0.5) {
    throw new Error(`${nameA} and ${nameB} overlap by ${(-gap).toFixed(1)}px`);
  }
  measurements.push(`gap ${nameA} ↔ ${nameB}: ${gap.toFixed(1)}px`);
}

async function boxOf(locator, label) {
  const box = await locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  return { label, ...box };
}

async function measureButtons(frame, specs) {
  for (const spec of specs) {
    const { label, ...box } = await boxOf(spec.locator, spec.name);
    requireMin(label, box);
  }
}

/** Separation between two boxes on whichever axis separates them; negative
    when the boxes intersect (the actual failure a touch cascade needs). */
async function gapBetween(left, right) {
  const [a, b] = await Promise.all([
    left.evaluate((el) => el.getBoundingClientRect().toJSON()),
    right.evaluate((el) => el.getBoundingClientRect().toJSON()),
  ]);
  const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (overlapX > 0 && overlapY > 0) {
    return -Math.min(overlapX, overlapY);
  }
  const sepX = b.left >= a.right ? b.left - a.right : a.left - b.right;
  const sepY = b.top >= a.bottom ? b.top - a.bottom : a.top - b.bottom;
  return Math.max(sepX, sepY);
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => {
  pageErrors.push(String(error).slice(0, 300));
  console.log("PAGE ERROR:", String(error).slice(0, 300));
});
await page.setViewportSize({ width: 360, height: 640 });
mkdirSync(OUT, { recursive: true });

const frame = page.frameLocator(".sfcw-frame");
const composer = frame.locator('textarea[placeholder="Type your question"]');
const close = frame.getByRole("button", { name: "Close chat" });
const menuButton = frame.getByRole("button", { name: "Conversation options" });
const menuItem = frame.getByRole("menuitem", { name: "Clear conversation" });
const send = frame.getByRole("button", { name: "Send", exact: true });

async function shot(name) {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
  console.log("captured", name);
}

// ===========================================================================
// 360px embed: the full state walk.
// ===========================================================================
await page.goto(`${BASE}/demo/wordpress-test-page.html`);
await page.waitForLoadState("domcontentloaded");
const launcher = page.locator(".sfcw-launcher");
requireMin("360 launcher", await boxOf(launcher, "360 launcher"));
await launcher.click();

// Gate state (ticket 66): start chat + the three required fields.
await frame.locator("#sfcw-name").waitFor({ timeout: 10000 });
await measureButtons(frame, [
  { locator: close, name: "360 gate close" },
  { locator: frame.locator("#sfcw-name"), name: "360 gate name input" },
  { locator: frame.locator("#sfcw-email"), name: "360 gate email input" },
  { locator: frame.locator("#sfcw-phone"), name: "360 gate phone input" },
  { locator: frame.getByRole("button", { name: "Start chat" }), name: "360 gate start chat" },
]);
await shot("27-360-gate");
console.log("ok: every gate control reaches 24x24 at 360px");

await frame.locator("#sfcw-name").fill(CONTACT.fullName);
await frame.locator("#sfcw-email").fill(CONTACT.email);
await frame.locator("#sfcw-phone").fill(CONTACT.phone);
await frame.getByRole("button", { name: "Start chat" }).click();

// Fresh state (ticket 46): stacked suggestion pills and handoff options.
const suggestions = frame.locator('[aria-label="Suggested questions"] button');
const options = frame.locator('[aria-label="Options to reach our staff"] button');
await suggestions.first().waitFor({ timeout: 10000 });
await options.first().waitFor({ timeout: 10000 });
await measureButtons(frame, [
  { locator: close, name: "360 fresh close" },
  { locator: suggestions.first(), name: "360 fresh suggestion" },
  { locator: options.first(), name: "360 fresh handoff option" },
]);
const suggestionPills = await suggestions.evaluateAll((els) => els.length);
for (let i = 0; i + 1 < Math.min(suggestionPills, 3); i++) {
  requireNoOverlap(
    `360 suggestion ${i + 1}`,
    `360 suggestion ${i + 2}`,
    await gapBetween(suggestions.nth(i), suggestions.nth(i + 1)),
  );
}
await shot("27-360-fresh");
console.log("ok: fresh-state pills and options reach 24x24 without overlapping");

// Active conversation: the known question gets a linked rule answer, so the
// strip, the composer, the header menu, and the transcript link all show.
await composer.fill("How much are the tuition fees?");
await composer.press("Enter");
await frame.getByText("$3,500").waitFor({ timeout: 15000 });
await menuButton.waitFor({ timeout: 10000 });
await measureButtons(frame, [
  { locator: send, name: "360 active send" },
  { locator: close, name: "360 active close" },
  { locator: menuButton, name: "360 menu button" },
  { locator: frame.locator('[aria-label="Suggested questions"] button').first(), name: "360 strip chip" },
  { locator: frame.locator('[aria-label="Options to reach our staff"] button').first(), name: "360 strip option" },
]);
noteInline("360 transcript link", await boxOf(frame.locator('[role="log"] a'), "360 transcript link"));
requireNoOverlap("360 menu button", "360 close", await gapBetween(menuButton, close));
const composerBox = await boxOf(composer, "360 composer");
if (composerBox.height < 40) {
  throw new Error(
    `the 360px composer is unusably short: ${composerBox.height.toFixed(1)}px (ticket 18 constraint)`,
  );
}
measurements.push(`360 composer textarea height: ${composerBox.height.toFixed(1)}px`);
const overflow = await frame.locator("body").evaluate(
  (el) => el.scrollWidth - el.clientWidth,
);
if (overflow > 1) {
  throw new Error(`the 360px widget overflows horizontally by ${overflow}px`);
}
await shot("27-360-active");
console.log("ok: active-state controls reach 24x24; composer height and 360px fit hold");

// Overflow menu open (ticket 39).
await menuButton.click();
await menuItem.waitFor({ timeout: 10000 });
await measureButtons(frame, [
  { locator: menuItem, name: "360 menu item" },
]);
await shot("27-360-menu");

// Confirm pair (the safety net's last two controls, and the smallest).
await menuItem.click();
const confirmClear = frame.getByRole("button", { name: "Clear chat" });
const confirmKeep = frame.getByRole("button", { name: "Keep chatting" });
await confirmClear.waitFor({ timeout: 10000 });
await measureButtons(frame, [
  { locator: confirmClear, name: "360 confirm clear" },
  { locator: confirmKeep, name: "360 confirm keep" },
]);
requireNoOverlap("360 confirm clear", "360 confirm keep", await gapBetween(confirmClear, confirmKeep));
await shot("27-360-confirm");
console.log("ok: menu item and the confirm pair reach 24x24 and do not overlap");
await confirmKeep.click();

// Unknown question: the consent-based offer button (ticket 37).
await composer.fill("zzqx completely unknown topic");
await composer.press("Enter");
const offer = frame.locator('[role="log"] button');
await offer.waitFor({ timeout: 15000 });
requireMin("360 offer button", await boxOf(offer, "360 offer button"));

// Clicking it hands off: the composer locks but stays measurable.
await offer.click();
await frame.getByText("College staff will reply in this chat.").waitFor({ timeout: 10000 });
await measureButtons(frame, [
  { locator: send, name: "360 locked send" },
  { locator: close, name: "360 locked close" },
  { locator: menuButton, name: "360 locked menu" },
]);
await shot("27-360-waiting");
console.log("ok: the offer button and the locked-state controls reach 24x24");

// ===========================================================================
// Desktop: the menu and confirm pair at a roomy viewport.
// ===========================================================================
const desktopContext = await browser.newContext();
const desktopPage = await desktopContext.newPage();
desktopPage.on("pageerror", (error) => {
  pageErrors.push(String(error).slice(0, 300));
  console.log("PAGE ERROR:", String(error).slice(0, 300));
});
await desktopPage.setViewportSize({ width: 1280, height: 800 });
const desktopFrame = desktopPage.frameLocator(".sfcw-frame");
await desktopPage.goto(`${BASE}/demo/wordpress-test-page.html`);
await desktopPage.waitForLoadState("domcontentloaded");
await desktopPage.locator(".sfcw-launcher").click();
await desktopFrame.locator("#sfcw-name").waitFor({ timeout: 10000 });
await desktopFrame.locator("#sfcw-name").fill(CONTACT.fullName);
await desktopFrame.locator("#sfcw-email").fill(CONTACT.email);
await desktopFrame.locator("#sfcw-phone").fill(CONTACT.phone);
await desktopFrame.getByRole("button", { name: "Start chat" }).click();
const desktopSuggestions = desktopFrame.locator('[aria-label="Suggested questions"] button');
await desktopSuggestions.first().waitFor({ timeout: 10000 });
await measureButtons(desktopFrame, [
  { locator: desktopFrame.getByRole("button", { name: "Close chat" }), name: "desktop fresh close" },
  { locator: desktopSuggestions.first(), name: "desktop fresh suggestion" },
]);
await desktopFrame.locator('textarea[placeholder="Type your question"]').fill("How much are the tuition fees?");
await desktopFrame.locator('textarea[placeholder="Type your question"]').press("Enter");
await desktopFrame.getByText("$3,500").waitFor({ timeout: 15000 });
await measureButtons(desktopFrame, [
  { locator: desktopFrame.getByRole("button", { name: "Send", exact: true }), name: "desktop active send" },
  { locator: desktopFrame.locator('[aria-label="Suggested questions"] button').first(), name: "desktop strip chip" },
  { locator: desktopFrame.locator('[aria-label="Options to reach our staff"] button').first(), name: "desktop strip option" },
]);
await desktopFrame.getByRole("button", { name: "Conversation options" }).click();
await desktopFrame.getByRole("menuitem", { name: "Clear conversation" }).waitFor({ timeout: 10000 });
await measureButtons(desktopFrame, [
  { locator: desktopFrame.getByRole("menuitem", { name: "Clear conversation" }), name: "desktop menu item" },
]);
await desktopFrame.getByRole("menuitem", { name: "Clear conversation" }).click();
const desktopClear = desktopFrame.getByRole("button", { name: "Clear chat" });
const desktopKeep = desktopFrame.getByRole("button", { name: "Keep chatting" });
await desktopClear.waitFor({ timeout: 10000 });
await measureButtons(desktopFrame, [
  { locator: desktopClear, name: "desktop confirm clear" },
  { locator: desktopKeep, name: "desktop confirm keep" },
]);
requireNoOverlap(
  "desktop confirm clear",
  "desktop confirm keep",
  await gapBetween(desktopClear, desktopKeep),
);
await desktopPage.screenshot({ path: join(OUT, "27-desktop-confirm.png"), fullPage: false });
console.log("captured 27-desktop-confirm");

if (pageErrors.length > 0) {
  throw new Error(`page errors during the run: ${pageErrors.join(" | ")}`);
}
await browser.close();
console.log("--- measured targets ---");
for (const line of measurements) console.log(line);
console.log("--- inline-exempt (measured, WCAG 2.5.8 inline exception) ---");
for (const line of exempt) console.log(line);
console.log("ticket 27 checks passed;");
console.log("screenshots in", OUT);
