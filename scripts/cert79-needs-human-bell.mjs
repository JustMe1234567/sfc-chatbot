// Ticket 79 certification (headless Chromium, one-off): the needs-human bell
// on the dashboard sidebar's Conversations navigation item. On a production
// build against a scratch Postgres store, a freshly bootstrapped owner signs
// in through the real UI (Supabase credentials + a fresh authenticator
// enrollment), and the run proves: the bell is absent with nothing waiting
// (row exactly as today — plain "Conversations" name, two icon strokes, no
// badge, no count), it appears within one poll cadence on a page that carries
// no desk data (Settings — the cross-page guarantee), it is identical in the
// collapsed icon rail, whose hover callout reads the same wording, the row's
// accessible name says "Conversations — needs human" only while it shows,
// the staff endpoint answers the boolean behind it (and rejects anonymous
// calls), and taking the waiting conversation over in the desk hides the
// bell again within one cadence.
//
// Usage: node scripts/cert79-needs-human-bell.mjs <outdir> [port]
// Env:   CHATBOT_CERT_PG_URL = the scratch Postgres DATABASE_URL (required;
//        its username must be postgres.<ref> matching the Supabase project —
//        the app refuses a store and auth project that disagree) plus the
//        Supabase trio (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
//        SUPABASE_SECRET_KEY) that the real sign-in runs against.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { TOTP, URI } from "otpauth";
import process from "node:process";

const OUT =
  process.argv[2] ?? ".scratch/college-website-chat/references/ticket79";
const BASE = `http://127.0.0.1:${process.argv[3] ?? "4391"}`;
const USERNAME = "cert79owner";
const PASSWORD = "cert79-bell-toll-8q";
const OWNER_NAME = "Olive Cert";
const VISITOR_NAME = "Cert Seventynine";
const PG_URL = process.env.CHATBOT_CERT_PG_URL;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!PG_URL) {
  throw new Error("CHATBOT_CERT_PG_URL (the scratch Postgres DATABASE_URL) is required");
}
if (!SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || !process.env.SUPABASE_SECRET_KEY) {
  throw new Error("the Supabase trio (URL, publishable key, secret key) is required for the real sign-in");
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

// The auth project and the store must agree on the project ref (the app
// itself enforces this) — fail fast with the exact posture the store needs.
const authRef = new URL(SUPABASE_URL).hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i)?.[1];
const storeRef = new URL(PG_URL).username.match(/^postgres\.([a-z0-9-]+)$/i)?.[1];
if (!authRef || !storeRef || authRef !== storeRef) {
  throw new Error(
    `CHATBOT_CERT_PG_URL's username must be postgres.${authRef} to match the auth project (got ${storeRef ?? "no ref"})`,
  );
}

// A service route initializes migrations + seeds; healthz alone does not.
await fetch(`${BASE}/api/v1/topics`);

// The scratch store handle (also used to reset + mirror the auth schema).
const sql = postgres(PG_URL, { max: 1, prepare: false });

// A re-run against a reused scratch store must start clean before the
// bootstrap: a stale staff row whose auth user was already cleaned up
// would refuse the provisioning.
await createAuthMirror();

// Bootstrap the cert owner into the scratch store (fresh DB): a real
// Supabase auth user plus the local staff row, exactly as deployment does.
execFileSync(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "scripts/bootstrap-owner.ts",
    "--username", USERNAME, "--password", PASSWORD, "--name", OWNER_NAME],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: PG_URL,
    },
    stdio: "inherit",
  },
);

// ---------------------------------------------------------------------------
// The scratch store's auth-schema mirror. In production the app's store IS
// the Supabase database, so `authenticate()` joins the live auth.sessions /
// auth.users / auth.mfa_factors rows through the store's own connection. A
// scratch store has no auth schema, so the cert mirrors exactly those three
// tables (only the columns the provider queries) and seeds them from the
// real signed-in session: the session and user rows come from the session
// cookie's own JWT (verified server-side by getClaims against the real
// project), and the factor row records the factor the real enrollment just
// created. Nothing here touches the app schema.
// ---------------------------------------------------------------------------
async function createAuthMirror() {
  // A re-run against a reused scratch store must start clean: leftover
  // conversations would light the bell before the run starts, and a stale
  // staff row whose auth user was already cleaned up would refuse the
  // bootstrap. The conversation-side wipe runs FIRST — the staff row goes
  // after it, since conversations.claimed_by references staff_members. The
  // seeded settings (handoff options etc.) survive: only conversation-side
  // state is wiped.
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS auth`);
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS auth.sessions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    not_after timestamptz
  )`);
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS auth.users (
    id uuid PRIMARY KEY,
    email text,
    email_confirmed_at timestamptz,
    deleted_at timestamptz,
    banned_until timestamptz
  )`);
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS auth.mfa_factors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    factor_type text NOT NULL,
    status text NOT NULL
  )`);
  await sql.unsafe(`TRUNCATE auth.sessions, auth.users, auth.mfa_factors`);
  await sql.unsafe(
    `TRUNCATE conversations, messages, notifications, visitor_sessions, return_tokens, audit_log CASCADE`,
  );
  await sql`DELETE FROM staff_members WHERE username = ${USERNAME}`;
}

function decodeJwtPayload(token) {
  const payload = token.split(".")[1];
  return JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
}

/** The signed-in session's claims, read from the browser's own cookies.
 *  @supabase/ssr writes one cookie (a `base64-`-prefixed session JSON) and,
 *  past its chunk limit, `<name>.0`, `<name>.1`, … string segments joined
 *  in index order — the prefix is stripped after the join. */
async function sessionClaims(page) {
  const cookies = await page.context().cookies();
  const base = `sb-${authRef}-auth-token`;
  const chunks = cookies
    .filter((cookie) => new RegExp(`^${base}\\.(0|[1-9][0-9]*)$`).test(cookie.name))
    .sort((a, b) => Number(a.name.split(".").at(-1)) - Number(b.name.split(".").at(-1)));
  let raw;
  if (chunks.length > 0) {
    raw = chunks.map((cookie) => cookie.value).join("");
  } else {
    raw = cookies.find((cookie) => cookie.name === base)?.value ?? null;
  }
  if (!raw) throw new Error("no session cookie found after sign-in");
  const encoded = raw.startsWith("base64-") ? raw.slice("base64-".length) : raw;
  const session = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  return decodeJwtPayload(session.access_token);
}

async function seedSessionRows(page) {
  const claims = await sessionClaims(page);
  await sql`INSERT INTO auth.users (id, email, email_confirmed_at, deleted_at, banned_until)
    VALUES (${claims.sub}::uuid, ${claims.email}::text, now(), NULL, NULL)
    ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO auth.sessions (id, user_id, not_after)
    VALUES (${claims.session_id}::uuid, ${claims.sub}::uuid, NULL)
    ON CONFLICT (id) DO NOTHING`;
  return claims;
}

/** Records the factor the real enrollment just created, so the app's own
 *  mfaEnrolled check (an EXISTS against auth.mfa_factors) sees it. */
async function seedVerifiedFactor(claims) {
  await sql`INSERT INTO auth.mfa_factors (user_id, factor_type, status)
    VALUES (${claims.sub}::uuid, 'totp', 'verified')`;
}

/** The conversation's escalation, driven through the real visitor API. */
async function escalateWaitingConversation() {
  const seeded = await (await fetch(`${BASE}/api/v1/handoff-options`)).json();
  if (!Array.isArray(seeded.options) || seeded.options.length === 0) {
    throw new Error("the handoff options did not seed");
  }
  const created = await fetch(`${BASE}/api/v1/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName: VISITOR_NAME,
      email: "cert79@example.org",
      phone: "+1 (555) 010-0179",
    }),
  });
  if (!created.ok) throw new Error(`conversation start failed: ${created.status}`);
  const { id, token } = await created.json();
  const post = (body) =>
    fetch(`${BASE}/api/v1/conversations/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  await post({ text: "Does the library open on weekends?" });
  await post({ handoffOption: seeded.options[0] });
  const yes = await post({ choice: "handoff-yes" });
  if (!yes.ok) throw new Error(`handoff confirm failed: ${yes.status}`);
  return id;
}

async function takeOverViaStaffApi(page, conversationId) {
  // The owner's claim, through the staff route the desk's own button posts
  // to — the button click is the browser journey; this is the same request
  // with the signed-in session's cookies, so the cert's later steps (which
  // already drive the real UI) stay focused on the bell.
  const response = await page.request.fetch(
    `${BASE}/api/staff/conversations/${conversationId}/claim`,
    { method: "POST", headers: { origin: BASE } },
  );
  if (!response.ok()) throw new Error(`claim failed: ${response.status()}`);
}

const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });

let failed = false;
try {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  const pageErrors = [];
  page.on("pageerror", (error) => {
    pageErrors.push(String(error).slice(0, 300));
    console.log("PAGE ERROR:", String(error).slice(0, 300));
  });

  async function shot(name) {
    await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
    console.log("captured", name);
  }

  /** The Conversations row's mark, read back from the DOM: its aria-label
   *  and its path count (bubble strokes alone, or bubble + bell). */
  function conversationsRow() {
    return page.locator("nav[aria-label=Dashboard] a", { hasText: "Conversations" }).first();
  }
  async function rowState() {
    const row = conversationsRow();
    return {
      label: await row.getAttribute("aria-label"),
      strokes: await row.locator("svg path").count(),
    };
  }
  async function expectRow(label, strokes, what) {
    const state = await rowState();
    if (state.label !== label || state.strokes !== strokes) {
      throw new Error(`${what}: expected row "${label}" with ${strokes} strokes, got "${state.label}" with ${state.strokes}`);
    }
    console.log("ok:", what, `— "${label}", ${strokes} strokes`);
  }

  // =========================================================================
  // Owner sign-in with fresh TOTP enrollment (fresh store). The desktop
  // rail is compact by default, so expand it first — every "expanded"
  // proof below runs with labels visible.
  // =========================================================================
  await page.goto(`${BASE}/dashboard/login`);
  await page.waitForLoadState("domcontentloaded");
  await page.fill("#username", USERNAME);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL("**/dashboard/enroll", { timeout: 45000 });
  // Mirror the just-established session into the scratch store's auth
  // schema (production joins these through the Supabase database itself).
  const claims = await seedSessionRows(page);
  await page.getByRole("button", { name: "Begin enrollment" }).click();
  await page.waitForSelector("code", { timeout: 45000 });
  const totp = URI.parse(`otpauth://totp/x?secret=${(await page.textContent("code")).trim()}`);
  await seedVerifiedFactor(claims);
  await page.fill("#totp", totp.generate());
  await page.click("button[type=submit]");
  await page.waitForURL("**/dashboard/login", { timeout: 45000 });
  await page.waitForSelector("#username", { timeout: 45000 });
  await page.fill("#username", USERNAME);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForSelector("#totp", { timeout: 45000 });
  // The second sign-in minted a fresh session; mirror it before the TOTP
  // verify so the app's own session join sees it.
  await seedSessionRows(page);
  await page.fill("#totp", totp.generate());
  await page.click("button[type=submit]");
  await page.waitForURL("**/dashboard/inbox", { timeout: 45000 });
  console.log("signed in; enrollment complete");
  await page.getByRole("button", { name: "Expand navigation" }).click();
  // The rail's width animates through the motion tokens; let it settle so
  // screenshots capture the finished expanded state, not the transition.
  await page.waitForTimeout(600);

  // =========================================================================
  // Nothing waiting: the row renders exactly as today — no bell, no badge,
  // no count — and the endpoint behind it answers false.
  // =========================================================================
  await expectRow("Conversations", 2, "nothing waiting (expanded rail)");
  const anonymous = await fetch(`${BASE}/api/v1/needs-human`);
  if (anonymous.status !== 401) throw new Error(`anonymous needs-human: ${anonymous.status}`);
  const staffed = await page.request.get(`${BASE}/api/v1/needs-human`);
  const staffBody = await staffed.json();
  if (staffed.status() !== 200 || staffBody.needsHuman !== false) {
    throw new Error(`staff needs-human with nothing waiting: ${staffed.status()} ${JSON.stringify(staffBody)}`);
  }
  console.log("ok: endpoint 401 anonymous / 200 {needsHuman:false} staff");
  await shot("79-bell-hidden-inbox-expanded");

  // =========================================================================
  // A real visitor escalates. Staff sit on Settings — a page with no desk
  // data — and the bell arrives within one poll cadence. (The row's
  // hidden state there was already proven on the inbox; the arrival
  // deadline is the proof, so no racy "before" assert.)
  // =========================================================================
  const conversationId = await escalateWaitingConversation();
  await page.goto(`${BASE}/dashboard/settings`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(
    () =>
      document.querySelector('nav[aria-label=Dashboard] a[aria-label="Conversations — needs human"]') &&
      document.querySelectorAll(
        'nav[aria-label=Dashboard] a[aria-label="Conversations — needs human"] svg path',
      ).length === 3,
    undefined,
    { timeout: 14000 },
  );
  console.log("ok: bell arrived on the settings page within one cadence");
  await shot("79-bell-showing-settings-expanded");

  // =========================================================================
  // The inbox desk, still showing; then the compact icon rail, whose hover
  // callout carries the same wording.
  // =========================================================================
  await page.goto(`${BASE}/dashboard/inbox`);
  await page.waitForLoadState("domcontentloaded");
  // The header's mount fetch races this assert, so wait for the showing
  // state rather than asserting it cold.
  await page.waitForFunction(
    () =>
      document.querySelector('nav[aria-label=Dashboard] a[aria-label="Conversations — needs human"]') &&
      document.querySelectorAll(
        'nav[aria-label=Dashboard] a[aria-label="Conversations — needs human"] svg path',
      ).length === 3,
    undefined,
    { timeout: 14000 },
  );
  await expectRow("Conversations — needs human", 3, "inbox page while waiting");
  await shot("79-bell-showing-inbox-expanded");

  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await expectRow("Conversations — needs human", 3, "collapsed rail while waiting");
  await conversationsRow().hover();
  await page.waitForSelector("[data-open]", { timeout: 5000 });
  const callout = (await page.textContent("[data-open]")) ?? "";
  if (!callout.includes("Conversations — needs human")) {
    throw new Error(`collapsed callout read "${callout.trim()}"`);
  }
  console.log("ok: collapsed callout mirrors the wording");
  await shot("79-bell-showing-inbox-collapsed");

  // =========================================================================
  // Taking the waiting conversation over hides the bell within one
  // cadence — in the collapsed rail and, re-expanded, in the expanded one.
  // =========================================================================
  await takeOverViaStaffApi(page, conversationId);
  await page.waitForFunction(
    () => {
      const row = document.querySelector('nav[aria-label=Dashboard] a[aria-label="Conversations"]');
      return row && row.querySelectorAll("svg path").length === 2;
    },
    undefined,
    { timeout: 14000 },
  );
  console.log("ok: bell hid after take over (collapsed rail)");
  await conversationsRow().hover();
  await page.waitForSelector("[data-open]", { timeout: 5000 });
  const clearedCallout = (await page.textContent("[data-open]")) ?? "";
  if (clearedCallout.trim() !== "Conversations") {
    throw new Error(`cleared callout read "${clearedCallout.trim()}"`);
  }
  await shot("79-bell-hidden-inbox-collapsed");

  await page.getByRole("button", { name: "Expand navigation" }).click();
  // Let the width animation settle before the capture (motion tokens).
  await page.waitForTimeout(600);
  await expectRow("Conversations", 2, "re-expanded after take over");
  await shot("79-bell-hidden-inbox-expanded-after");

  // The staff endpoint now answers false again.
  const after = await page.request.get(`${BASE}/api/v1/needs-human`);
  const afterBody = await after.json();
  if (afterBody.needsHuman !== false) {
    throw new Error(`needs-human after claim: ${JSON.stringify(afterBody)}`);
  }
  console.log("ok: endpoint answers false after take over");

  if (pageErrors.length > 0) {
    throw new Error(`page errors during the run: ${pageErrors.join(" | ")}`);
  }
  console.log("CERT 79 PASS");
} catch (error) {
  failed = true;
  console.error("CERT 79 FAIL:", error?.message ?? error);
} finally {
  // Best-effort cleanup: the cert's Supabase auth user does not linger in
  // the real project (the scratch store's staff row dies with the database).
  try {
    const owner = await sql`SELECT "supabaseUserId" FROM staff_members WHERE "username" = ${USERNAME} LIMIT 1`;
    const authUserId = owner[0]?.supabaseUserId;
    if (authUserId) {
      const key = process.env.SUPABASE_SECRET_KEY;
      const deleted = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${authUserId}`, {
        method: "DELETE",
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      console.log(deleted.ok ? "cleaned up the cert auth user" : `auth user cleanup: ${deleted.status}`);
    }
  } catch (cleanupError) {
    console.log("auth user cleanup skipped:", String(cleanupError).slice(0, 200));
  }
  await sql.end({ timeout: 5 });
  await browser.close();
}
if (failed) process.exit(1);
