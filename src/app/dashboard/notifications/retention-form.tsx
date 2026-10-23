"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_RETENTION_DAYS, MIN_RETENTION_DAYS, isValidRetentionDays } from "@/settings";
import styles from "../dashboard.module.css";

export interface RetentionFormRun {
  ranAt: string;
  removedConversations: number;
}

/**
 * Owner configuration of the transcript retention period (ticket 10). A
 * closed conversation's transcript and visitor contact details are removed
 * once this many days pass; while unconfigured they are kept indefinitely.
 * Saving runs the cleanup immediately.
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
  const [busy, setBusy] = useState(false);

  async function save(period: number | null) {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/staff/settings/transcript-retention", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: period }),
    });
    setBusy(false);
    if (!response.ok) {
      const failure = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setMessage(failure?.error?.message ?? "Could not save the retention period.");
      return;
    }
    const result = (await response.json()) as { days: number | null; removed: number };
    if (period === null) {
      setMessage("Retention cleared; closed transcripts are kept indefinitely.");
    } else {
      setMessage(
        result.removed > 0
          ? `Saved. ${result.removed} expired conversation${result.removed === 1 ? "" : "s"} removed now.`
          : "Retention period saved.",
      );
    }
    router.refresh();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) {
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
    <form className={styles.ruleCard} onSubmit={submit}>
      <h2>Transcript retention</h2>
      <p className={styles.hint}>
        Closed conversations are removed with their messages and visitor email
        addresses once this many days have passed, and their return links stop
        working. Leave empty to keep closed transcripts indefinitely.
      </p>
      <label htmlFor="retention-days">Retention period (days)</label>
      <input
        id="retention-days"
        type="number"
        inputMode="numeric"
        min={MIN_RETENTION_DAYS}
        max={MAX_RETENTION_DAYS}
        step={1}
        value={days}
        onChange={(event) => setDays(event.target.value)}
      />
      <div className={styles.publishBar}>
        <button type="submit" disabled={busy}>
          Save period
        </button>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={busy}
          onClick={() => void save(null)}
        >
          Clear
        </button>
      </div>
      <p className={styles.hint}>
        {lastRun
          ? `Last cleanup removed ${lastRun.removedConversations} conversation${
              lastRun.removedConversations === 1 ? "" : "s"
            } on ${new Date(lastRun.ranAt).toLocaleString("en-GB")}.`
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
