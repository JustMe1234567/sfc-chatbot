import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/paths";

const FORM = "src/app/dashboard/notifications/alert-settings-form.tsx";
const CSS = "src/app/dashboard/dashboard.module.css";

/**
 * Ticket 54: the Staff alert recipients form becomes one box per email —
 * stacked rows with Edit/Delete on the right and an Add area — persisting
 * every action immediately through the unchanged whole-list PUT. The API,
 * its validation, and its role checks are not touched.
 */

async function readForm(): Promise<string> {
  return readFile(path.join(repoRoot(), FORM), "utf8");
}

describe("the recipients form is a stacked box list (ticket 54)", () => {
  it("renders a semantic list of boxes; the comma input and bulk Save are gone", async () => {
    const form = await readForm();
    expect(form).toMatch(/<ul className=\{styles\.recipientList\}/);
    expect(form).toMatch(/\.map\(\(recipient,/);
    expect(form).not.toContain("Comma-separated");
    expect(form).not.toContain("Save recipients");
    // The old whole-string state is gone with the input.
    expect(form).not.toContain('initialRecipients.join(", ")');
    // A fresh install sees a hint, not a blank input.
    expect(form).toContain("recipients.length === 0");
  });

  it("gives every box Edit and Delete icon buttons with accessible names", async () => {
    const form = await readForm();
    // Inline SVG marks ride along the ticket-52 approach: no icon library.
    expect(form).toMatch(/function (Mark|Icon)\(/);
    expect(form).not.toMatch(/react-icons|lucide|heroicons|@iconify|@mui\/icons/);
    expect(form).not.toMatch(/fill="#(?!none)/);
    // Real names, derived from the address they act on. The plain Edit
    // button takes aria-label; the PendingButton instances use the shared
    // component's ariaLabel/ariaDescribedBy slots.
    expect(form).toContain("aria-label={`Edit ${recipient}`}");
    expect(form).toContain("ariaLabel={`Delete ${recipient}`}");
    expect(form).toContain('ariaLabel="Add recipient"');
  });

  it("edits in place with Save/Cancel, Enter to save, Escape to cancel", async () => {
    const form = await readForm();
    // The address becomes an email input inside the same box.
    expect(form).toMatch(/id=\{`recipient-edit-\$\{index\}`\}/);
    expect(form).toMatch(/onKeyDown/);
    expect(form).toContain('"Enter"');
    expect(form).toContain('"Escape"');
    expect(form).toContain("Cancel");
  });

  it("persists every action immediately through the unchanged PUT", async () => {
    const form = await readForm();
    expect(form).toContain("/api/staff/settings/alert-recipients");
    expect(form).toContain("JSON.stringify({ recipients");
    // One shared mutation queue used by add, edit-save, and delete alike.
    expect(form).toContain("enqueueMutation");
    // The endpoint and its body shape are what the API tests pin.
    expect(form).not.toMatch(/fetch\([^)]*\/delete|fetch\([^)]*\/recipients\//);
  });

  it("rejects malformed and duplicate addresses inline before anything saves", async () => {
    const form = await readForm();
    expect(form).toContain("isValidRecipientEmail");
    // Duplicates can never enter the list: the check compares lowercased
    // addresses against the current list.
    expect(form).toMatch(/toLowerCase\(\)/);
    expect(form).toContain("already on the list");
    // The acting row stays in edit mode with the message inline.
    expect(form).toMatch(/role="alert"/);
  });

  it("disables Delete on the last remaining box with an inline explanation", async () => {
    const form = await readForm();
    expect(form).toMatch(/length === 1/);
    expect(form).toContain("At least one recipient must stay on the list");
    expect(form).toMatch(/ariaDescribedBy=/);
  });

  it("shows row-level pending treatment and reverts on failure", async () => {
    const form = await readForm();
    // One in-flight action at a time, named per verb (ticket 42).
    for (const verb of ["Saving…", "Deleting…", "Adding…"]) {
      expect(form, verb).toContain(verb);
    }
    // Optimistic apply with a snapshot to restore when the PUT fails.
    expect(form).toMatch(/snapshot/);
    expect(form).toMatch(/role="status"/);
  });

  it("serializes actions so an in-flight save cannot be clobbered", async () => {
    const form = await readForm();
    // A promise queue chains the PUTs; each runner recomputes from the
    // latest list through a ref, so parallel clicks land in order.
    expect(form).toContain("queueRef");
    expect(form).toContain("recipientsRef");
    // The runner validates against that latest list, not a stale closure.
    expect(form).toMatch(/validate\([^)]*current,/);
  });

  it("manages focus across actions", async () => {
    const form = await readForm();
    // After a delete, focus lands on the next box (or the Add input when the
    // stack emptied); after an edit-save or cancel, back on that row's Edit.
    expect(form).toMatch(/focusRequest/);
    expect(form).toMatch(/addInputRef/);
    expect(form).toMatch(/editRefs/);
  });
});

describe("the box styling stays in the dashboard tokens (ticket 54)", () => {
  it("rows, icon buttons at the touch floor, and a wrapping narrow layout", async () => {
    const css = await readFile(path.join(repoRoot(), CSS), "utf8");
    expect(css).toMatch(/\.recipientList \{/);
    expect(css).toMatch(/\.recipientRow \{/);
    expect(css).toMatch(/\.recipientAddress \{[^}]*text-overflow: ellipsis/s);
    expect(css).toMatch(/\.recipientIcon \{[^}]*min-height: 44px/s);
    // At 360px the address and its controls stack vertically, not squeeze.
    expect(css).toMatch(/\(max-width: 480px\) \{[^}]*\.recipientAddress \{[^}]*flex-basis: 100%/s);
    expect(css).toMatch(/\.recipientRow \{[^}]*flex-wrap: wrap/s);
  });

  it("keeps the form owner-only where it lives today", async () => {
    const page = await readFile(
      path.join(repoRoot(), "src/app/dashboard/notifications/page.tsx"),
      "utf8",
    );
    expect(page).toContain("<AlertSettingsForm initialRecipients={recipients} />");
    expect(page).toContain('guard.staff.role === "owner"');
  });
});

describe("the single-address validator is exported for the form (ticket 54)", () => {
  it("exports isValidRecipientEmail on the same pattern the API enforces", async () => {
    const settings = await readFile(path.join(repoRoot(), "src/settings.ts"), "utf8");
    expect(settings).toContain("export function isValidRecipientEmail");

    const { isValidRecipientEmail, isValidRecipientList } = await import("../src/settings");
    expect(isValidRecipientEmail("front-desk@example.edu")).toBe(true);
    expect(isValidRecipientEmail("not-an-address")).toBe(false);
    expect(isValidRecipientEmail("spaces in@example.edu")).toBe(false);
    expect(isValidRecipientList(["front-desk@example.edu"])).toBe(true);
  });
});
