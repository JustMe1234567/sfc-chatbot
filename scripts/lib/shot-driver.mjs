// Shared driver for the screenshot scripts (ticket 33): the healthz wait,
// the fresh-TOTP enrollment slate, and the enroll-and-sign-in flow through
// the real UI, so each shot script starts at its own capture work instead
// of re-implementing the bootstrap.
import { DatabaseSync } from "node:sqlite";
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
 * A clean enrollment slate for the screenshot owner: wipes any prior TOTP
 * enrollment and sessions the owner left behind — the script enrolls fresh
 * each run, and twoFactor.enable rejects while a factor is already active.
 * Returns whether an owner existed to wipe.
 */
export function freshTotpSlate(dbPath, email) {
  const db = new DatabaseSync(dbPath);
  const owner = db.prepare('SELECT id FROM "user" WHERE email = ?').get(email);
  if (owner) {
    db.prepare("DELETE FROM twoFactor WHERE userId = ?").run(owner.id);
    db.prepare('UPDATE "user" SET "twoFactorEnabled" = 0 WHERE id = ?').run(owner.id);
    db.prepare('DELETE FROM "session" WHERE "userId" = ?').run(owner.id);
  }
  db.close();
  return owner !== undefined;
}

/**
 * Enrolls the owner's TOTP through the real UI and signs in with the full
 * password + code flow, landing on the dashboard inbox. A password-only
 * session reaches /dashboard/enroll directly (the login page's code stage
 * presumes an existing token); enrollment signs out, so the second pass is
 * a complete sign-in. Returns the enrolled TOTP generator — callers that
 * sign in again (reduced-motion passes) reuse it.
 */
export async function enrollAndSignIn(page, base, email, password) {
  await page.goto(`${base}/dashboard/login`);
  await page.waitForLoadState("domcontentloaded");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForTimeout(3000);
  await page.goto(`${base}/dashboard/enroll`);
  await page.waitForLoadState("domcontentloaded");
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForSelector("code", { timeout: 15000 });
  const secret = (await page.textContent("code")).trim();
  // URI.parse is the code path the test suite proves correct; a bare
  // Secret({b32}) decodes better-auth's ASCII-string secrets differently.
  const totp = URI.parse(`otpauth://totp/x?secret=${secret}`);
  await page.fill("#totp", totp.generate());
  await page.click("button[type=submit]");
  await page.waitForURL("**/dashboard/login", { timeout: 15000 });
  await page.fill("#email", email);
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
export async function signInWithTotp(page, base, email, password, totp) {
  await page.goto(`${base}/dashboard/login`);
  await page.waitForLoadState("domcontentloaded");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForSelector("#totp", { timeout: 15000 });
  await page.fill("#totp", totp.generate());
  await page.click("button[type=submit]");
  await page.waitForURL("**/dashboard/inbox", { timeout: 15000 });
}
