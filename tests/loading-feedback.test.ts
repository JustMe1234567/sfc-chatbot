import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/paths";

async function read(rel: string): Promise<string> {
  return readFile(path.join(repoRoot(), rel), "utf8");
}

/**
 * Ticket 42's contract: one shared pending-button pattern with an active
 * verb while the action runs, synchronous duplicate-click protection, a
 * reduced-motion-gated spinner, and instant loading states for dashboard
 * routes. The verb inventory below pins every user-triggered asynchronous
 * control so a button can never silently fall back to a resting label.
 */
describe("shared pending feedback (ticket 42)", () => {
  it("ships one PendingButton with synchronous duplicate-click protection", async () => {
    const component = await read("src/app/dashboard/pending-button.tsx");
    expect(component).toContain("aria-busy");
    expect(component).toContain("pendingSpinner");
    // The ref guard closes the click-to-render gap: a second click inside
    // the same tick is swallowed, not deferred to the async state flip.
    expect(component).toContain("inFlightRef.current = true");
    expect(component).toContain("preventDefault()");
    expect(component).toContain("pendingLabel");
  });

  it("animates the spinner only under no-preference motion", async () => {
    const css = await read("src/app/dashboard/dashboard.module.css");
    expect(css).toContain(".pendingSpinner");
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*\.pendingSpinner \{[^}]*animation/s,
    );
  });

  it("labels every dashboard conversation action with its active verb", async () => {
    const actions = await read("src/app/dashboard/conversations/[id]/conversation-actions.tsx");
    for (const verb of ["Taking over…", "Releasing…", "Transferring…", "Sending…", "Closing…"]) {
      expect(actions).toContain(verb);
    }
    for (const uses of ["ClaimButton", "ReleaseAndTransfer", "ReplyAndClose"]) {
      expect(actions).toContain("PendingButton");
    }
  });

  it("labels publishing, saving, retrying, and staff actions with their verbs", async () => {
    const cases: Array<[string, string[]]> = [
      ["src/app/dashboard/answers/publish-controls.tsx", ["Publishing…", "Unpublishing…"]],
      ["src/app/dashboard/answers/rule-form.tsx", ["Saving…"]],
      ["src/app/dashboard/answers/escalation-phrases-form.tsx", ["Saving…"]],
      ["src/app/dashboard/answers/welcome-form.tsx", ["Saving…"]],
      ["src/app/dashboard/notifications/retry-button.tsx", ["Retrying…"]],
      ["src/app/dashboard/notifications/support-hours-form.tsx", ["Saving…", "Clearing…"]],
      ["src/app/dashboard/notifications/retention-form.tsx", ["Saving…", "Resetting…"]],
      ["src/app/dashboard/notifications/alert-settings-form.tsx", ["Saving…", "Deleting…", "Adding…"]],
      ["src/app/dashboard/analytics/analytics-settings-form.tsx", ["Saving…"]],
      ["src/app/dashboard/staff/invite-form.tsx", ["Creating…"]],
    ];
    for (const [file, verbs] of cases) {
      const source = await read(file);
      expect(source, file).toContain("PendingButton");
      for (const verb of verbs) {
        expect(source, `${file} → ${verb}`).toContain(verb);
      }
    }
    // Ticket 51 moved the disable confirmation into the shared dialog: the
    // trigger is a plain button and the "Disabling…" verb lives on the
    // dialog's PendingButton confirm control.
    const disable = await read("src/app/dashboard/staff/disable-button.tsx");
    expect(disable).toContain("Disabling…");
    expect(disable).toContain("ConfirmDialog");
  });

  it("labels authentication and sign-out with their active verbs", async () => {
    const login = await read("src/app/dashboard/login/page.tsx");
    expect(login).toContain("Signing in…");
    expect(login).toContain("Verifying…");
    const enroll = await read("src/app/dashboard/enroll/page.tsx");
    expect(enroll).toContain("Verifying…");
    const signOut = await read("src/app/dashboard/inbox/sign-out-button.tsx");
    expect(signOut).toContain("Signing out…");
    expect(signOut).toContain("Revoking sessions…");
  });

  it("keeps the desk mounted with row-level pending on conversation clicks", async () => {
    // The reopened acceptance supersedes the instant shell for conversation
    // clicks: a route-level loading.tsx above the desk would blank the
    // transcript the moment a row is clicked, so none may exist on the
    // dashboard segment (initial loads are server-rendered regardless).
    const loadingExists = await readFile(
      path.join(repoRoot(), "src/app/dashboard/loading.tsx"),
      "utf8",
    ).then(
      () => true,
      () => false,
    );
    expect(loadingExists).toBe(false);

    const row = await read("src/app/dashboard/inbox/desk-entry.tsx");
    expect(row).toContain("useLinkStatus");
    expect(row).toContain('aria-busy={pending || undefined}');
    expect(row).toContain("Loading…");
    // The hint is always rendered and fades in — no layout shift (the
    // useLinkStatus doc's own guidance).
    expect(row).toContain("rowPending");

    // The busy attribute lives on the row body (the hook's descendant-of-
    // Link contract); the stylesheet must bridge it onto the row with
    // :has(), or the pending styles can never match.
    const css = await read("src/app/dashboard/dashboard.module.css");
    expect(css).toMatch(/\.deskItem:has\(\.deskItemBody\[aria-busy="true"\]\)/);
    expect(css).not.toContain("button[aria-busy");
  });
});
