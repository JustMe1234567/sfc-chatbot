import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/paths";

const DESK = "src/app/dashboard/inbox/conversation-desk.tsx";
const ENTRY = "src/app/dashboard/inbox/desk-entry.tsx";
const CSS = "src/app/dashboard/dashboard.module.css";

/**
 * Ticket 47: History behaves exactly like the active Conversations list —
 * one compact preview row per conversation, the full transcript only after
 * the row is selected. The desk already shares one component set between
 * the two views (ticket 12), so these pins hold that parity in place while
 * the retention default changes underneath it.
 */
describe("history shows the same compact rows as the live desk (ticket 47)", () => {
  it("renders History through the shared desk, and selections stay in History", async () => {
    const route = await readFile(
      path.join(repoRoot(), "src/app/dashboard/inbox/history/page.tsx"),
      "utf8",
    );
    // One compact list per conversation; the transcript opens in the pane,
    // never inline in the list.
    expect(route).toContain('<ConversationDesk selectedId={null} view="history" />');

    const detail = await readFile(
      path.join(repoRoot(), "src/app/dashboard/inbox/[id]/page.tsx"),
      "utf8",
    );
    // The pane's tab and back link follow the conversation's own lifecycle,
    // so a row clicked in History keeps the History tab and back link —
    // with the ticket-104 exception: an open email/phone request pins the
    // conversation in Active, so its deep link opens the Active view.
    expect(detail).toContain("isDeskActive(conversation, openRequest !== null && openRequest.medium !== \"chat\")");

    const desk = await readFile(path.join(repoRoot(), DESK), "utf8");
    expect(desk).toContain('href={view === "history" ? "/dashboard/inbox/history" : "/dashboard/inbox"}');
  });

  it("keeps the compact row anatomy: state, time, clamped preview, one selection", async () => {
    const entry = await readFile(path.join(repoRoot(), ENTRY), "utf8");
    // State text and the latest-message preview with its role prefix.
    expect(entry).toContain("{DESK_STATE_LABELS[item.state]}");
    expect(entry).toContain("${roleLabel(item.lastMessage.role)}: ${item.lastMessage.text}");
    // The clamp is CSS, not JS slicing: the full text stays in the row for
    // assistive tech and never lands in a tooltip or accessible name.
    expect(entry).toContain("dateTime={item.lastActivityAt}");
    expect(entry).toContain('aria-current={selected ? "true" : undefined}');
    expect(entry).toContain('data-selected={selected || undefined}');
    expect(entry).toContain("aria-busy={pending || undefined}");
    // Ticket 42's row-level Loading… feedback serves History selections too.
    expect(entry).toContain("Loading…");

    const css = await readFile(path.join(repoRoot(), CSS), "utf8");
    const preview = css.slice(css.indexOf(".deskItemPreview {"), css.indexOf("}", css.indexOf(".deskItemPreview {")));
    expect(preview).toContain("-webkit-line-clamp: 2");
    expect(preview).toContain("text-overflow: ellipsis");
  });
});

describe("the retention default is 30 days (ticket 47)", () => {
  it("sweeps at the configured period or the 30-day default, and refuses a corrupt value", async () => {
    const settings = await readFile(path.join(repoRoot(), "src/settings.ts"), "utf8");
    expect(settings).toContain("export const DEFAULT_RETENTION_DAYS = 30;");
    // The corrupt-row guarantee survives the new default: an invalid stored
    // period is its own state, and the sweep refuses on it.
    expect(settings).toContain('kind: "invalid"');

    const retention = await readFile(path.join(repoRoot(), "src/domain/retention.ts"), "utf8");
    expect(retention).toContain("DEFAULT_RETENTION_DAYS");
    expect(retention).toContain('setting.kind === "invalid"');
    // The old "unconfigured disables the sweep" branch must be gone: an
    // install that never set a period still sheds transcripts past 30 days.
    expect(retention).not.toContain("retentionDays === null");
  });

  it("states the effective value and the permanence warning on the dashboard", async () => {
    const form = await readFile(
      path.join(repoRoot(), "src/app/dashboard/notifications/retention-form.tsx"),
      "utf8",
    );
    // Clearing no longer promises indefinite keeping: with no period set,
    // the 30-day default applies, and the control says so. The value is
    // interpolated from the DEFAULT_RETENTION_DAYS constant, not hand-typed.
    expect(form).toContain("placeholder={String(DEFAULT_RETENTION_DAYS)}");
    expect(form).toContain("default of {DEFAULT_RETENTION_DAYS} days");
    expect(form).toContain("Reset to default");
    expect(form).toContain("Retention reset to the ${DEFAULT_RETENTION_DAYS}-day default");
    expect(form).toContain("permanently");
    expect(form).toContain("visitor email addresses");
    expect(form).not.toContain("kept indefinitely");

    const page = await readFile(
      path.join(repoRoot(), "src/app/dashboard/settings/page.tsx"),
      "utf8",
    );
    // The read-only summary shows the effective value, not "kept forever",
    // counted from entering History rather than closure alone (ticket 62).
    expect(page).toContain("<RetentionForm");

    const route = await readFile(
      path.join(repoRoot(), "src/app/api/staff/settings/transcript-retention/route.ts"),
      "utf8",
    );
    expect(route).toContain("reset to the ${DEFAULT_RETENTION_DAYS}-day default");
    expect(route).not.toContain("keep transcripts indefinitely");
  });
});
