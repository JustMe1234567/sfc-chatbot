// Shared driver for the screenshot scripts (ticket 33): the healthz wait
// and the sign-in flow through the real UI, so each shot script starts at
// its own capture work instead of re-implementing the bootstrap.
// Ticket 80: staff sign-in is username + password verified by hosted
// Supabase Auth — staff rows live in staff_members — and ticket 82 made
// that the whole flow: no enrollment stage exists any more.

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
 * Signs the staff member in through the real login page (single-stage
 * username + password since ticket 82), landing on the dashboard inbox.
 */
export async function signIn(page, base, username, password) {
  await page.goto(`${base}/dashboard/login`);
  await page.waitForLoadState("domcontentloaded");
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("**/dashboard/inbox", { timeout: 60000 });
  console.log("signed in");
}
