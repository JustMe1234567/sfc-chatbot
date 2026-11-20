// Ticket 76 certification (headless Chromium, one-off): the owner-managed
// embed allowlist, certified in PRODUCTION mode against a scratch Postgres
// database — the posture visitors actually run under. On a production server
// only allowlisted exact HTTPS origins may host the widget, so this proves:
// the seeded list and the boolean-only eligibility answer, loopback origins
// denied as production websites (the dev exceptions are vitest territory —
// pure decisions plus route wiring in the test environment), the
// frame-ancestors header tracking owner saves with no redeploy including
// 'none' for a deliberately emptied list, unauthorized origins denied with
// the host page left completely untouched (the app's own origin and a second
// local origin are both real denials), and the full visitor journey on a
// genuinely HTTPS origin the owner added through the allowlist (self-signed
// local stand-in for the college site), including an allowlist save riding
// through while that chat stays open. Production standalone access to the
// frame is refused at the HTTP layer.
//
// Usage: node scripts/cert76-embed-allowlist.mjs <outdir> [port] [hostPort]
// Env:   CHATBOT_CERT_PG_URL = the scratch Postgres DATABASE_URL (required)
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { createServer as httpServer } from "node:http";
import { createServer as httpsServer } from "node:https";
import postgres from "postgres";
import { join } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";

const OUT =
  process.argv[2] ?? ".scratch/college-website-chat/references/ticket76";
const BASE = `http://127.0.0.1:${process.argv[3] ?? "4376"}`;
const HTTP_HOST_PORT = Number(process.argv[4] ?? "9402");
const HTTPS_HOST_PORT = HTTP_HOST_PORT + 1;
const HTTP_HOST = `http://127.0.0.1:${HTTP_HOST_PORT}`;
const HTTPS_HOST = `https://127.0.0.1:${HTTPS_HOST_PORT}`;
const PG_URL = process.env.CHATBOT_CERT_PG_URL;
if (!PG_URL) {
  throw new Error("CHATBOT_CERT_PG_URL (the scratch Postgres DATABASE_URL) is required");
}

for (let attempt = 0; ; attempt++) {
  try {
    await fetch(`${BASE}/api/healthz`);
    break;
  } catch {
    if (attempt > 60) throw new Error("server never came up");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

const SEED = ["https://springfieldcollege.ca"];

// The scratch database's allowlist row, driven directly: the cert proves the
// widget surfaces' behavior against real server responses; the owner API/UI
// contract (roles, validation, persistence) is the vitest suite's territory.
const sql = postgres(PG_URL, { max: 1, prepare: false });
async function storedAllowlist() {
  const rows = await sql`SELECT value FROM settings WHERE key = 'embed_allowlist'`;
  return JSON.parse(rows[0].value);
}
async function saveAllowlist(origins) {
  await sql`UPDATE settings SET value = ${JSON.stringify(origins)}, updated_at = ${new Date().toISOString()} WHERE key = 'embed_allowlist'`;
}

const HOST_PAGE = `<!doctype html><html><head><title>Cert 76 host</title></head>
<body><p>A page that wants the chatbot.</p>
<script src="${BASE}/widget/v1.js"></script></body></html>`;

function startHttpHost(port) {
  return new Promise((resolve) => {
    const server = httpServer((request, response) => {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(HOST_PAGE);
    });
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function startHttpsHost(port, tls) {
  return new Promise((resolve) => {
    const server = httpsServer(tls, (request, response) => {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(HOST_PAGE);
    });
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function eligibility(origin) {
  const response = await fetch(`${BASE}/api/v1/embed-eligibility?origin=${encodeURIComponent(origin)}`);
  const text = await response.text();
  return { response, text, body: JSON.parse(text) };
}

async function frameResponse(extraHeaders = {}) {
  return fetch(`${BASE}/widget/frame`, { headers: extraHeaders });
}

const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();
const consoleLines = [];
const pageErrors = [];
page.on("pageerror", (error) => {
  pageErrors.push(String(error).slice(0, 300));
  console.log("PAGE ERROR:", String(error).slice(0, 300));
});
page.on("console", (message) => consoleLines.push(message.text()));
await page.setViewportSize({ width: 1280, height: 800 });
mkdirSync(OUT, { recursive: true });

async function shot(name) {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
  console.log("captured", name);
}

async function assertJourney(hostUrl) {
  await page.goto(`${hostUrl}/`, { waitUntil: "load" });
  const launcher = page.locator(".sfcw-launcher");
  await launcher.waitFor({ timeout: 10000 });
  await launcher.click();
  const frame = page.frameLocator(".sfcw-frame");
  await frame.locator("#sfcw-name").waitFor({ timeout: 10000 });
  await frame.locator("#sfcw-name").fill("Jane Doe");
  await frame.locator("#sfcw-email").fill("jane.doe@example.org");
  await frame.locator("#sfcw-phone").fill("(555) 010-0199");
  await frame.getByRole("button", { name: "Start chat" }).click();
  await frame.locator('textarea[placeholder="Type your question"]').fill("How much are the tuition fees?");
  await frame.locator('textarea[placeholder="Type your question"]').press("Enter");
  await frame.getByText("$3,500").waitFor({ timeout: 15000 });
}

let firstHttpHost;
let httpsHost;
try {
  // =========================================================================
  // Seeded state and the boolean-only eligibility answer (real server).
  // =========================================================================
  if (JSON.stringify(await storedAllowlist()) !== JSON.stringify(SEED)) {
    throw new Error(`the scratch db was not freshly seeded: ${JSON.stringify(await storedAllowlist())}`);
  }
  const denied = await eligibility("https://alumni.example");
  if (denied.response.status !== 200 || denied.body.allowed !== false) {
    throw new Error("an unlisted origin was not denied");
  }
  if (JSON.stringify(Object.keys(denied.body)) !== '["allowed"]') {
    throw new Error(`the eligibility response leaked shape: ${denied.text}`);
  }
  if (denied.text.includes("springfieldcollege") || denied.text.includes("origins")) {
    throw new Error(`the eligibility response leaked allowlist data: ${denied.text}`);
  }
  if ((await eligibility("https://springfieldcollege.ca")).body.allowed !== true) {
    throw new Error("the seeded college origin was not allowed");
  }
  // Production website rules: the loopback origins are denied too — the
  // development exceptions live outside production only (vitest proves the
  // outside-production branch and the route wiring in the test environment).
  if ((await eligibility("http://localhost:3000")).body.allowed !== false) {
    throw new Error("a loopback origin was allowed as a production website");
  }
  console.log("ok: eligibility is boolean-only; denies unlisted and loopback, allows the seed");

  // =========================================================================
  // The frame-ancestors header tracks owner saves with no redeploy, and a
  // deliberately emptied list refuses every parent ('none').
  // =========================================================================
  const seededPolicy = (await frameResponse({ "sec-fetch-dest": "iframe" })).headers.get(
    "content-security-policy",
  );
  if (seededPolicy !== "frame-ancestors https://springfieldcollege.ca") {
    throw new Error(`the seeded policy is not the allowlist alone: ${seededPolicy}`);
  }
  await saveAllowlist([...SEED, "https://alumni.example"]);
  const addedPolicy = (await frameResponse({ "sec-fetch-dest": "iframe" })).headers.get(
    "content-security-policy",
  );
  if (addedPolicy !== "frame-ancestors https://springfieldcollege.ca https://alumni.example") {
    throw new Error(`a saved origin did not reach the frame policy: ${addedPolicy}`);
  }
  await saveAllowlist([]);
  const emptiedPolicy = (await frameResponse({ "sec-fetch-dest": "iframe" })).headers.get(
    "content-security-policy",
  );
  if (emptiedPolicy !== "frame-ancestors 'none'") {
    throw new Error(`an emptied allowlist did not refuse every parent: ${emptiedPolicy}`);
  }
  await saveAllowlist(SEED);
  console.log("ok: the frame policy follows saves immediately and 'none' when emptied");

  // =========================================================================
  // Production standalone access to the frame is refused at the HTTP layer.
  // =========================================================================
  const standalone = await frameResponse();
  if (standalone.status !== 404) {
    throw new Error(`production standalone navigation returned ${standalone.status}, expected 404`);
  }
  const framed = await frameResponse({ "sec-fetch-dest": "iframe" });
  if (framed.status !== 200) {
    throw new Error(`a framed frame request returned ${framed.status}`);
  }
  console.log("ok: standalone production access renders nothing; framed access passes");

  // =========================================================================
  // REAL denials leave host pages untouched: the app's own origin (an http
  // origin is never a production website) and a second local origin.
  // =========================================================================
  firstHttpHost = await startHttpHost(HTTP_HOST_PORT);
  const consoleBefore = consoleLines.length;
  await page.goto(`${BASE}/demo/wordpress-test-page.html`, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  const demoDenied = await page.evaluate(() => ({
    launchers: document.querySelectorAll(".sfcw-launcher").length,
    frames: document.querySelectorAll("iframe").length,
    styles: Array.from(document.querySelectorAll("style")).filter((style) =>
      style.textContent.includes("sfcw-launcher"),
    ).length,
  }));
  if (demoDenied.launchers !== 0 || demoDenied.frames !== 0 || demoDenied.styles !== 0) {
    throw new Error(`the denied app-origin page was mutated: ${JSON.stringify(demoDenied)}`);
  }
  const diagnostic = consoleLines
    .slice(consoleBefore)
    .find((line) => line.includes("The chat widget is not available on this page."));
  if (!diagnostic) {
    throw new Error("the generic deny diagnostic never appeared on the denied page");
  }
  await shot("76-denied-untouched");
  await page.goto(`${HTTP_HOST}/`, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  const hostDenied = await page.evaluate(() => ({
    launchers: document.querySelectorAll(".sfcw-launcher").length,
    frames: document.querySelectorAll("iframe").length,
  }));
  if (hostDenied.launchers !== 0 || hostDenied.frames !== 0) {
    throw new Error(`the second unauthorized page was mutated: ${JSON.stringify(hostDenied)}`);
  }
  console.log("ok: unauthorized pages render nothing and log only the generic diagnostic");

  // =========================================================================
  // An owner-added exact HTTPS origin hosts the working widget with no
  // redeploy — the exact production shape (self-signed local stand-in for
  // the college site).
  // =========================================================================
  // The throwaway key material lives in a temp dir: the out dir is the
  // tracked screenshots home and never carries private keys.
  const certDir = mkdtempSync(join(tmpdir(), "sfc-cert76-"));
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
  httpsHost = await startHttpsHost(HTTPS_HOST_PORT, {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  });

  if ((await eligibility(HTTPS_HOST)).body.allowed !== false) {
    throw new Error("the https host was allowed before the owner added it");
  }
  await saveAllowlist([...SEED, HTTPS_HOST]);
  if ((await eligibility(HTTPS_HOST)).body.allowed !== true) {
    throw new Error("the owner-added https origin did not become eligible immediately");
  }
  await assertJourney(HTTPS_HOST);
  await shot("76-https-allowed-journey");
  console.log("ok: an owner-added exact HTTPS origin hosts the working widget with no redeploy");

  // =========================================================================
  // An allowlist save rides through while the chat stays open.
  // =========================================================================
  await saveAllowlist([...SEED, "https://alumni.example"]);
  const frame = page.frameLocator(".sfcw-frame");
  await frame.locator('textarea[placeholder="Type your question"]').fill("How much are the tuition fees?");
  await frame.locator('textarea[placeholder="Type your question"]').press("Enter");
  await frame.getByText("$3,500").first().waitFor({ timeout: 15000 });
  console.log("ok: the already-open chat survived an allowlist save without disruption");
  await saveAllowlist(SEED);
} finally {
  await saveAllowlist(SEED);
  if (firstHttpHost) firstHttpHost.close();
  if (httpsHost) httpsHost.close();
}

if (pageErrors.length > 0) {
  throw new Error(`page errors during the run: ${pageErrors.join(" | ")}`);
}
await browser.close();
await sql.end({ timeout: 5 });
console.log("cert 76 complete");
