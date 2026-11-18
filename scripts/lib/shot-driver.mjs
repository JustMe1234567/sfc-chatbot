// Shared driver for the screenshot scripts (ticket 33): the healthz wait
// and the enroll-and-sign-in flow through the real UI, so each shot script
// starts at its own capture work instead of re-implementing the bootstrap.
// Ticket 80: staff sign-in is username + password verified by hosted
// Supabase Auth — staff rows live in staff_members and TOTP factors in the
// hosted auth schema — so no driver function touches a local enrollment
// table (the SQLite-era freshTotpSlate is gone; enrollAndSignIn fails fast
// with instructions when it meets an owner who is already enrolled).
import { TOTP, URI } from "otpauth";

/** Waits until the server answers /api/healthz, or throws. */
export async function waitForServer(base) {
  for (let attempt = 0; ; attempt++) {
    try {
      await fetch(`${base}/api/healthz`);
      return;
    } catch {
      if (attempt > 40) throw new Error("server never came up");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

/**
 * Fail-fast guard for the demo-page widget steps (ticket 78): ticket 76's
 * production embed allowlist admits only allowlisted HTTPS origins, so under
 * a production build the loopback demo origin is denied and every launcher
 * wait would time out opaquely. Outside production the trusted application
 * origins keep the demo origin embeddable — these steps are dev-mode-only,
 * and this probe turns the denial into a clear instruction.
 */
export async function assertDemoOriginEmbeddable(base) {
  const response = await fetch(`${base}/api/v1/embed-eligibility?origin=${encodeURIComponent(base)}`);
  if (!response.ok) {
    throw new Error(`the embed eligibility probe failed: ${response.status}`);
  }
  const body = await response.json();
  if (body.allowed !== true) {
    throw new Error(
      `the demo origin ${base} is not an allowed widget host on this server — ` +
        "under a production build the ticket-76 embed allowlist admits only allowlisted HTTPS origins. " +
        `These widget steps are dev-mode-only: run \`next dev\` with CHATBOT_BASE_URL=${base} and re-run against that origin.`,
    );
  }
}

/**
 * Enrolls the owner's TOTP through the real UI and signs in with the full
 * password + code flow, landing on the dashboard inbox. The owner must be
 * freshly provisioned: a verified factor never reaches /dashboard/enroll —
 * the credentials stage flips to the login page's own TOTP challenge — and
 * this driver cannot re-derive a secret an earlier run enrolled, because
 * factors live in hosted Supabase Auth rather than a store table a script
 * could wipe (the SQLite-era freshTotpSlate is gone for exactly that
 * reason). Enrollment signs out, so the second pass is a complete sign-in
 * against the same-page TOTP stage. Returns the enrolled TOTP generator —
 * callers that sign in again (reduced-motion passes) reuse it.
 */
export async function enrollAndSignIn(page, base, username, password) {
  await page.goto(`${base}/dashboard/login`);
  await page.waitForLoadState("domcontentloaded");
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  try {
    // 60s: the first visit cold-compiles the login and enroll routes on a
    // dev server.
    await page.waitForURL("**/dashboard/enroll", { timeout: 60000 });
  } catch {
    throw new Error(
      "sign-in did not reach /dashboard/enroll — either the credentials were refused or " +
        "the owner already has a verified authenticator (the login page flips to its own " +
        "TOTP stage instead, and this driver cannot re-derive a factor an earlier run " +
        "enrolled; run against a freshly bootstrapped owner).",
    );
  }
  await page.getByRole("button", { name: "Begin enrollment" }).click();
  await page.waitForSelector("code", { timeout: 60000 });
  const totp = URI.parse(`otpauth://totp/x?secret=${(await page.textContent("code")).trim()}`);
  await page.fill("#totp", totp.generate());
  await page.click("button[type=submit]");
  await page.waitForURL("**/dashboard/login", { timeout: 15000 });
  // Full sign-in with the second factor: the credentials stage flips to the
  // TOTP stage on the same page.
  await page.waitForSelector("#username", { timeout: 15000 });
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForSelector("#totp", { timeout: 15000 });
  await page.fill("#totp", totp.generate());
  await page.click("button[type=submit]");
  await page.waitForURL("**/dashboard/inbox", { timeout: 15000 });
  console.log("signed in; enrollment complete");
  return totp;
}

/** Re-signed-in helper for passes that reuse an enrolled TOTP. */
export async function signInWithTotp(page, base, username, password, totp) {
  await page.goto(`${base}/dashboard/login`);
  await page.waitForLoadState("domcontentloaded");
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForSelector("#totp", { timeout: 15000 });
  await page.fill("#totp", totp.generate());
  await page.click("button[type=submit]");
  await page.waitForURL("**/dashboard/inbox", { timeout: 15000 });
}
