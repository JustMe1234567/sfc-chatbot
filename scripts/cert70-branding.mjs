// Ticket 70 certification (headless Chromium, one-off): configurable
// branding. On a production build, signs a freshly bootstrapped owner in
// through the real UI and drives the Settings page — the three cards, the
// SVG refusal, a real chatbot-icon upload, the chathead appearance save —
// then proves the saved values reach the live surfaces without a redeploy:
// the versioned asset bytes, the dashboard favicon link (and the demo
// page's independence from it), and the launcher chathead's background +
// configured icon. Reset restores the bundled crest bytes.
//
// Ticket 78 harness: ticket 76's production embed allowlist denies every
// loopback HTTP origin, so the widget steps can no longer drive the demo
// page. Instead the run serves a minimal host page from a self-signed local
// HTTPS origin — the exact production shape — and adds that exact origin to
// the embed allowlist through a direct settings write (the cert76 recipe;
// the owner API/UI contract is the vitest suite's territory). The captured
// settings rows (allowlist + branding) are restored when the run ends,
// cleanly or not. The store must be fresh: the chathead defaults are
// asserted up front, and a customized store fails fast. Requires the
// store's Postgres URL in CHATBOT_CERT_PG_URL — the SQLite-era recipe is
// gone because the Supabase auth stack owns staff sign-in.
// Usage: node scripts/cert70-branding.mjs <outdir> [port] [hostPort] [username]
// Env:   CHATBOT_CERT_PG_URL = the store's Postgres DATABASE_URL (required)
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer as httpsServer } from "node:https";
import { join } from "node:path";
import { tmpdir } from "node:os";
import postgres from "postgres";
import process from "node:process";
import { signIn } from "./lib/shot-driver.mjs";

const OUT =
  process.argv[2] ?? ".scratch/college-website-chat/references/ticket70";
const BASE = `http://127.0.0.1:${process.argv[3] ?? "3235"}`;
const HOST_PORT = Number(process.argv[4] ?? "9452");
const HTTPS_HOST = `https://127.0.0.1:${HOST_PORT}`;
const USERNAME = process.argv[5] ?? "owner";
const PASSWORD = "Springfield2026!";
const PG_URL = process.env.CHATBOT_CERT_PG_URL;
if (!PG_URL) {
  throw new Error("CHATBOT_CERT_PG_URL (the store's Postgres DATABASE_URL) is required");
}

for (let attempt = 0; ; attempt++) {
  try {
    await fetch(`${BASE}/api/healthz`);
    break;
  } catch {
    if (attempt > 40) throw new Error("server never came up");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// The store's settings rows, driven directly (the cert76 pattern): the
// widget steps need an allowlist entry the owner UI cannot legitimately
// grant a loopback origin, and every touched row is restored afterwards.
const sql = postgres(PG_URL, { max: 1, prepare: false });
const CAPTURED_KEYS = [
  "embed_allowlist",
  "branding_chatbot_icon",
  "branding_dashboard_favicon",
  "branding_chathead",
];
const captured = new Map();
async function captureSettings() {
  for (const key of CAPTURED_KEYS) {
    const rows = await sql`SELECT value, updated_at FROM settings WHERE key = ${key}`;
    captured.set(key, rows.length > 0 ? rows[0] : null);
  }
}
async function restoreSettings() {
  for (const key of CAPTURED_KEYS) {
    const row = captured.get(key);
    if (row) {
      await sql`UPDATE settings SET value = ${row.value}, updated_at = ${row.updated_at} WHERE key = ${key}`;
    } else {
      await sql`DELETE FROM settings WHERE key = ${key}`;
    }
  }
}
async function storedAllowlist() {
  const rows = await sql`SELECT value FROM settings WHERE key = 'embed_allowlist'`;
  return rows.length > 0 ? JSON.parse(rows[0].value) : [];
}
async function saveAllowlist(origins) {
  await sql`UPDATE settings SET value = ${JSON.stringify(origins)}, updated_at = ${new Date().toISOString()} WHERE key = 'embed_allowlist'`;
}

let httpsHost;
let browser;
try {
  await captureSettings();

  // Fresh-store guard: the cert walks defaults → customized → restored, so
  // a store with saved branding would fail the default assertions midway.
  // Fail here instead, with the reason.
  const branding = await (await fetch(`${BASE}/api/v1/branding`)).json();
  const chathead = branding.chathead;
  if (
    chathead.backgroundColor !== "#013c78" ||
    chathead.iconSize !== 48 ||
    chathead.padding !== 4 ||
    chathead.width !== 64 ||
    chathead.height !== 64
  ) {
    throw new Error(
      `the target store's chathead is not at the bundled defaults (${JSON.stringify(chathead)}): this cert expects a fresh, unconfigured store`,
    );
  }

  // The cert76 recipe: the throwaway key material lives in a temp dir — the
  // out dir is the tracked screenshots home and never carries private keys.
  const certDir = mkdtempSync(join(tmpdir(), "sfc-cert70-"));
  const keyPath = join(certDir, "host-key.pem");
  const certPath = join(certDir, "host-cert.pem");
  const generated = spawnSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath,
     "-subj", "/CN=127.0.0.1", "-days", "1"],
    { stdio: "ignore" },
  );
  if (generated.status !== 0) {
    throw new Error("openssl could not generate the self-signed host certificate");
  }
  const HOST_PAGE = `<!doctype html><html><head><title>Cert 70 host</title></head>
<body><p>A page that wants the chatbot.</p>
<script src="${BASE}/widget/v1.js"></script></body></html>`;
  httpsHost = await new Promise((resolve) => {
    const server = httpsServer(
      { key: readFileSync(keyPath), cert: readFileSync(certPath) },
      (request, response) => {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(HOST_PAGE);
      },
    );
    server.listen(HOST_PORT, "127.0.0.1", () => resolve(server));
  });

  const storedList = await storedAllowlist();
  if (storedList.includes(HTTPS_HOST)) {
    throw new Error(`the cert host ${HTTPS_HOST} is already allowlisted; run against a fresh store`);
  }
  await saveAllowlist([...storedList, HTTPS_HOST]);
  const eligibility = await (
    await fetch(`${BASE}/api/v1/embed-eligibility?origin=${encodeURIComponent(HTTPS_HOST)}`)
  ).json();
  if (eligibility.allowed !== true) {
    throw new Error("the cert host did not become eligible after the allowlist write");
  }
  console.log("ok: the cert host is allowlisted and eligible");

  // A real 1x1 PNG (red pixel) as the upload payload.
  const PNG_1X1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const SVG_1X1 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="2" height="2"/></svg>');

  const DEFAULT_ICON_BYTES = Buffer.from(await (await fetch(`${BASE}/api/branding/chatbot-icon`)).arrayBuffer());
  const DEFAULT_FAVICON_BYTES = Buffer.from(await (await fetch(`${BASE}/api/branding/dashboard-favicon`)).arrayBuffer());
  if (!DEFAULT_ICON_BYTES.length || !DEFAULT_FAVICON_BYTES.length) {
    throw new Error("the bundled assets did not serve before the run");
  }

  browser = await chromium.launch();
  // ignoreHTTPSErrors: the cert host's certificate is deliberately
  // self-signed (the local stand-in for the college site).
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
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

  // =========================================================================
  // Owner sign-in (password-only flow since ticket 82, fresh store).
  // =========================================================================
  await signIn(page, BASE, USERNAME, PASSWORD);

  // =========================================================================
  // The Settings page: nav destination, three cards, default chathead.
  // =========================================================================
  await page.goto(`${BASE}/dashboard/settings`);
  await page.waitForLoadState("domcontentloaded");
  const settingsLink = page.locator('nav[aria-label="Dashboard"] a[aria-label="Settings"]');
  if ((await settingsLink.count()) !== 1) {
    throw new Error("the Settings destination is missing from the dashboard nav");
  }
  for (const title of ["Chatbot icon and chathead", "Chatbot icon", "Dashboard favicon"]) {
    await page.getByRole("heading", { name: title, exact: true }).waitFor({ timeout: 10000 });
  }
  const previewBg = await page.locator('[aria-labelledby="branding-chathead-title"] .chatheadPreview, [aria-labelledby="branding-chathead-title"] span[style*="background"]').first().evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  if (previewBg !== "rgb(1, 60, 120)") {
    throw new Error(`the default chathead preview is ${previewBg}, expected #013c78`);
  }
  await shot("70-settings-default");
  console.log("ok: Settings is a nav destination with the three cards and the default chathead");

  // The favicon link exists on dashboard pages and points at the branding route.
  const loginHtml = await (await fetch(`${BASE}/dashboard/login`)).text();
  if (!loginHtml.includes("/api/branding/dashboard-favicon")) {
    throw new Error("the dashboard login page does not reference the branding favicon route");
  }
  const demoHtml = await (await fetch(`${BASE}/demo/wordpress-test-page.html`)).text();
  if (demoHtml.includes("/api/branding")) {
    throw new Error("the public demo page unexpectedly references a branding route");
  }
  console.log("ok: the favicon scope is dashboard-only");

  // =========================================================================
  // Upload validation: SVG refused with clear feedback, nothing saved.
  // =========================================================================
  await page.locator("#dashboard-favicon-file").setInputFiles({
    name: "mark.svg",
    mimeType: "image/svg+xml",
    buffer: SVG_1X1,
  });
  await page.getByText("Choose a PNG, JPEG, or WebP image up to 500 KB.").waitFor({ timeout: 10000 });
  let faviconAfter = Buffer.from(await (await fetch(`${BASE}/api/branding/dashboard-favicon`)).arrayBuffer());
  if (!faviconAfter.equals(DEFAULT_FAVICON_BYTES)) {
    throw new Error("the refused SVG changed the stored favicon");
  }
  console.log("ok: an SVG upload is refused server- and client-side without saving");

  // =========================================================================
  // Save the favicon, then the chatbot icon, then the chathead appearance.
  // =========================================================================
  await page.locator("#dashboard-favicon-file").setInputFiles({
    name: "favicon.png",
    mimeType: "image/png",
    buffer: PNG_1X1,
  });
  await page.getByRole("button", { name: "Save favicon" }).click();
  await page.locator('[aria-labelledby="branding-favicon-title"]').getByText("Saved.", { exact: true }).waitFor({ timeout: 10000 });
  const savedFavicon = Buffer.from(await (await fetch(`${BASE}/api/branding/dashboard-favicon`)).arrayBuffer());
  if (!savedFavicon.equals(PNG_1X1)) {
    throw new Error("the saved favicon bytes are not the upload");
  }
  const loginHtml2 = await (await fetch(`${BASE}/dashboard/login`)).text();
  if (loginHtml2.includes("dashboard-favicon?v=default")) {
    throw new Error("the login favicon link did not move to the new version");
  }
  await page.locator("#chatbot-icon-file").setInputFiles({
    name: "icon.png",
    mimeType: "image/png",
    buffer: PNG_1X1,
  });
  await page.getByRole("button", { name: "Save icon" }).click();
  await page.locator('[aria-labelledby="branding-icon-title"]').getByText("Saved.", { exact: true }).waitFor({ timeout: 10000 });
  const savedIcon = Buffer.from(await (await fetch(`${BASE}/api/branding/chatbot-icon`)).arrayBuffer());
  if (!savedIcon.equals(PNG_1X1)) {
    throw new Error("the saved chatbot icon bytes are not the upload");
  }
  console.log("ok: both uploads save and serve their exact bytes");

  await page.locator("#chathead-bg").fill("#7a0030");
  await page.getByRole("button", { name: "Save appearance" }).click();
  await page.locator('[aria-labelledby="branding-chathead-title"]').getByText("Saved.", { exact: true }).waitFor({ timeout: 10000 });
  const brandingAfterSave = await (await fetch(`${BASE}/api/v1/branding`)).json();
  if (brandingAfterSave.chathead.backgroundColor !== "#7a0030" || brandingAfterSave.chathead.foreground !== "#ffffff" || brandingAfterSave.chathead.width !== 64 || brandingAfterSave.chathead.height !== 64) {
    throw new Error(`the saved chathead config is wrong: ${JSON.stringify(brandingAfterSave.chathead)}`);
  }
  await shot("70-settings-saved");
  console.log("ok: the chathead save reaches the public branding read with the derived foreground and 64x64 dimensions");

  // =========================================================================
  // Ticket 71: a configuration whose icon and padding do not fit is blocked
  // with the required minimum, leaving the stored values unchanged.
  // =========================================================================
  await page.locator("#chathead-icon-size").fill("64");
  await page.locator("#chathead-padding").fill("12");
  await page.locator("#chathead-width").fill("44");
  await page.getByRole("button", { name: "Save appearance" }).click();
  await page.getByText("The icon and padding need at least 88 × 88 px.").waitFor({ timeout: 10000 });
  const afterRefusal = await (await fetch(`${BASE}/api/v1/branding`)).json();
  if (afterRefusal.chathead.iconSize !== 48 || afterRefusal.chathead.width !== 64) {
    throw new Error(`the refused save changed the stored config: ${JSON.stringify(afterRefusal.chathead)}`);
  }
  console.log("ok: a non-fitting configuration is refused with the required minimum and nothing stored changes");
  await page.locator("#chathead-icon-size").fill("48");
  await page.locator("#chathead-padding").fill("4");

  // A rectangular configuration that fits saves and renders: the smallest
  // icon (32px, no padding) needs only 32 × 32, so 96 × 44 is legal.
  await page.locator("#chathead-icon-size").fill("32");
  await page.locator("#chathead-padding").fill("0");
  await page.locator("#chathead-width").fill("96");
  await page.locator("#chathead-height").fill("44");
  await page.getByRole("button", { name: "Save appearance" }).click();
  await page.locator('[aria-labelledby="branding-chathead-title"]').getByText("Saved.", { exact: true }).waitFor({ timeout: 10000 });
  const rectangular = await (await fetch(`${BASE}/api/v1/branding`)).json();
  if (rectangular.chathead.width !== 96 || rectangular.chathead.height !== 44) {
    throw new Error(`the rectangular config did not save: ${JSON.stringify(rectangular.chathead)}`);
  }
  console.log("ok: a rectangular 96 x 44 chathead saves");

  // =========================================================================
  // The live surfaces: launcher chathead and frame icon on the allowlisted
  // HTTPS cert host (ticket 78; the loopback demo origin is denied in
  // production by design).
  // =========================================================================
  await page.goto(`${HTTPS_HOST}/`);
  await page.waitForLoadState("domcontentloaded");
  await page.locator(".sfcw-launcher").waitFor({ timeout: 10000 });
  await page.waitForFunction(() => {
    const launcher = document.querySelector(".sfcw-launcher");
    if (!launcher || getComputedStyle(launcher).backgroundColor !== "rgb(122, 0, 48)") {
      return false;
    }
    const box = launcher.getBoundingClientRect();
    // The rectangular configuration (96 × 44) renders as-is, with the corner
    // radius at 25% of the smaller dimension (44 × .25 = 11px).
    const radius = Number.parseFloat(getComputedStyle(launcher).borderTopLeftRadius);
    return (
      Math.abs(box.width - 96) < 0.5 &&
      Math.abs(box.height - 44) < 0.5 &&
      Math.abs(radius - 11) < 0.5
    );
  }, undefined, { timeout: 15000 });
  const launcherSrc = await page.locator(".sfcw-launcher img").evaluate((el) => el.getAttribute("src"));
  if (!launcherSrc.includes("/api/branding/chatbot-icon")) {
    throw new Error(`the launcher icon did not switch to the uploaded asset: ${launcherSrc}`);
  }
  // The opened frame hangs above the configured 44px height (16 + 44 + 4 = 64
  // from the bottom) and horizontal placement keeps both on screen.
  await page.locator(".sfcw-launcher").click();
  await page.waitForFunction(() => {
    const frame = document.querySelector(".sfcw-frame");
    const launcher = document.querySelector(".sfcw-launcher");
    if (!frame || !launcher) return false;
    const frameBox = frame.getBoundingClientRect();
    const launcherBox = launcher.getBoundingClientRect();
    return launcherBox.top - frameBox.bottom >= 3.5 && launcherBox.top - frameBox.bottom < 4.5;
  }, undefined, { timeout: 15000 });
  const frameHandle = page.frames().find((f) => f.url().includes("/widget/frame"));
  if (!frameHandle) throw new Error("the widget frame did not appear");
  await frameHandle.waitForSelector("#sfcw-name", { timeout: 10000 });
  const crestSrc = await frameHandle.locator("img").first().getAttribute("src");
  if (!crestSrc || !crestSrc.includes("/api/branding/chatbot-icon")) {
    throw new Error(`the frame identity icon did not switch: ${crestSrc}`);
  }
  await shot("70-demo-branded");
  console.log("ok: the rectangular launcher renders with its proportional radius and the frame hangs above the configured height");

  // Phone viewport: the widest-and-tallest launcher and the open frame stay
  // inside 360px without horizontal overflow or obstruction.
  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) {
    throw new Error(`the 360px page overflows horizontally by ${overflow}px with a 96px launcher`);
  }
  await page.locator(".sfcw-launcher").click();
  await page.waitForTimeout(400);
  const phoneOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (phoneOverflow > 1) {
    throw new Error(`the opened frame overflows 360px by ${phoneOverflow}px`);
  }
  await shot("70-demo-rectangular-360");
  console.log("ok: the rectangular launcher and the open frame fit 360px without overflow");
  await page.setViewportSize({ width: 1280, height: 800 });

  // =========================================================================
  // Reset restores the bundled assets, independently.
  // =========================================================================
  await page.goto(`${BASE}/dashboard/settings`);
  await page.getByRole("button", { name: "Reset favicon" }).click();
  await page.locator('[aria-labelledby="branding-favicon-title"]').getByText("Reset to the bundled image.").waitFor({ timeout: 10000 });
  const resetFavicon = Buffer.from(await (await fetch(`${BASE}/api/branding/dashboard-favicon`)).arrayBuffer());
  if (!resetFavicon.equals(DEFAULT_FAVICON_BYTES)) {
    throw new Error("the favicon reset did not restore the bundled asset");
  }
  const stillBrandedIcon = Buffer.from(await (await fetch(`${BASE}/api/branding/chatbot-icon`)).arrayBuffer());
  if (!stillBrandedIcon.equals(PNG_1X1)) {
    throw new Error("the favicon reset clobbered the chatbot icon");
  }
  console.log("ok: resetting the favicon restores the bundled asset and leaves the icon alone");

  if (pageErrors.length > 0) {
    throw new Error(`page errors during the run: ${pageErrors.join(" | ")}`);
  }
  await browser.close();
  console.log("ticket 70 checks passed;");
  console.log("screenshots in", OUT);
} finally {
  try {
    await restoreSettings();
    console.log("ok: the captured settings rows were restored");
  } catch (restoreError) {
    console.log("RESTORE FAILED — the store may keep the run's settings:", restoreError);
  }
  if (httpsHost) httpsHost.close();
  if (browser) await browser.close();
  await sql.end({ timeout: 5 });
}
