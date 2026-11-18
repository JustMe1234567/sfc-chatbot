"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_LOGIN_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  isValidRetentionDays,
} from "@/settings";
import PendingButton from "../pending-button";
import styles from "../dashboard.module.css";

/**
 * Owner configuration of the login retention period (ticket 81): how many
 * days of login events the Logs tab keeps before the daily maintenance pass
 * removes them. While no period is set, the default of 90 days applies.
 * Saving runs the cleanup immediately.
 */
export default function LoginRetentionForm({
  initialDays,
}: {
  initialDays: number | null;
}) {
  const router = useRouter();
  const [days, setDays] = useState(initialDays === null ? "" : String(initialDays));
  const [message, setMessage] = useState("");
  // Which action is in flight, so each button names its own verb (ticket 42).
  const [pendingAction, setPendingAction] = useState<"save" | "clear" | null>(null);

  async function save(period: number | null) {
    setPendingAction(period === null ? "clear" : "save");
    setMessage("");
    const response = await fetch("/api/staff/settings/login-retention", {
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
    const removedNote =
      result.removed > 0
        ? ` ${result.removed} old ${result.removed === 1 ? "entry" : "entries"} removed now.`
        : "";
    setMessage(
      period === null
        ? `Reset to the ${DEFAULT_LOGIN_RETENTION_DAYS}-day default.${removedNote}`
        : `Retention period saved.${removedNote}`,
    );
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
      <h2>Login retention</h2>
      <p className={styles.hint}>
        Every dashboard sign-in attempt in the Logs tab is removed once this
        many days have passed. Leave empty to use the default of{" "}
        {DEFAULT_LOGIN_RETENTION_DAYS} days.
      </p>
      <div className={styles.formField}>
        <label htmlFor="login-retention-days">Retention period</label>
        <div className={styles.inputSuffix}>
          <input
            id="login-retention-days"
            type="number"
            inputMode="numeric"
            min={MIN_RETENTION_DAYS}
            max={MAX_RETENTION_DAYS}
            step={1}
            placeholder={String(DEFAULT_LOGIN_RETENTION_DAYS)}
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
      {message ? (
        <p className={styles.hint} role="status">
          {message}
        </p>
      ) : null}
    </form>
  );
}
