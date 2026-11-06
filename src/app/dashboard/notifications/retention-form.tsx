"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  isValidRetentionDays,
} from "@/settings";
import PendingButton from "../pending-button";
import styles from "../dashboard.module.css";

export interface RetentionFormRun {
  ranAt: string;
  removedConversations: number;
}

/** "1 conversation" / "3 conversations", for the sweep-result lines. */
function removedConversationsLabel(count: number): string {
  return `${count} conversation${count === 1 ? "" : "s"}`;
}

/**
 * Owner configuration of the transcript retention period (ticket 10,
 * amended by tickets 47 and 62). A History conversation's transcript and
 * visitor contact details — closed, or inactive for a day in any state —
 * are removed permanently once this many days pass after it entered
 * History; while no period is set, the default of 30 days applies. Saving
 * runs the cleanup immediately.
 */
export default function RetentionForm({
  initialDays,
  lastRun,
}: {
  initialDays: number | null;
  lastRun: RetentionFormRun | null;
}) {
  const router = useRouter();
  const [days, setDays] = useState(initialDays === null ? "" : String(initialDays));
  const [message, setMessage] = useState("");
  // Which action is in flight, so each button names its own verb (ticket 42).
  const [pendingAction, setPendingAction] = useState<"save" | "clear" | null>(null);

  async function save(period: number | null) {
    setPendingAction(period === null ? "clear" : "save");
    setMessage("");
    const response = await fetch("/api/staff/settings/transcript-retention", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: period }),
    });
    setPendingAction(null);
    if (!response.ok) {
      const failure = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setMessage(failure?.error?.message ?? "Could not save the retention period.");
      return;
    }
    const result = (await response.json()) as { days: number | null; removed: number };
    // The input reflects the saved state: a reset returns the field to the
    // empty "default applies" state instead of lingering at the typed value.
    setDays(period === null ? "" : String(period));
    if (period === null) {
      setMessage(
        result.removed > 0
          ? `Reset to the ${DEFAULT_RETENTION_DAYS}-day default. ${removedConversationsLabel(result.removed)} removed now.`
          : `Retention reset to the ${DEFAULT_RETENTION_DAYS}-day default.`,
      );
    } else {
      setMessage(
        result.removed > 0
          ? `Saved. ${removedConversationsLabel(result.removed)} removed now.`
          : "Retention period saved.",
      );
    }
    router.refresh();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pendingAction) {
      return;
    }
    const parsed = Number(days);
    if (days.trim() === "" || !isValidRetentionDays(parsed)) {
      setMessage(`Enter a whole number of days between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS}.`);
      return;
    }
    await save(parsed);
  }

  return (
    <form className={`${styles.ruleCard} ${styles.alertSettingsCard}`} onSubmit={submit}>
      <h2>Transcript retention</h2>
      <p className={styles.hint}>
        Every History conversation, closed or inactive, is removed
        permanently — with its messages, visitor email addresses, and return
        links — once this many days have passed since it moved to History.
        Live conversations are never removed. Leave empty to use the
        default of {DEFAULT_RETENTION_DAYS} days.
      </p>
      <div className={styles.formField}>
        <label htmlFor="retention-days">Retention period</label>
        <div className={styles.inputSuffix}>
          <input
            id="retention-days"
            type="number"
            inputMode="numeric"
            min={MIN_RETENTION_DAYS}
            max={MAX_RETENTION_DAYS}
            step={1}
            placeholder={String(DEFAULT_RETENTION_DAYS)}
            value={days}
            onChange={(event) => setDays(event.target.value)}
          />
          <span aria-hidden="true">days</span>
        </div>
      </div>
      <div className={styles.formActions}>
        <PendingButton
          type="submit"
          pending={pendingAction === "save"}
          pendingLabel="Saving…"
          disabled={pendingAction === "clear"}
        >
          Save period
        </PendingButton>
        <PendingButton
          type="button"
          className={styles.secondaryButton}
          pending={pendingAction === "clear"}
          pendingLabel="Resetting…"
          disabled={pendingAction === "save"}
          onClick={() => void save(null)}
        >
          Reset to default
        </PendingButton>
      </div>
      <p className={styles.hint}>
        {lastRun
          ? `Last cleanup removed ${removedConversationsLabel(lastRun.removedConversations)} on ${new Date(lastRun.ranAt).toLocaleString("en-GB")}.`
          : "No cleanup has removed anything yet."}
      </p>
      {message ? (
        <p className={styles.hint} role="status">
          {message}
        </p>
      ) : null}
    </form>
  );
}
