"use client";

import { useState } from "react";
import { isValidRetentionDays, MAX_RETENTION_DAYS, MIN_RETENTION_DAYS } from "@/settings";
import styles from "../dashboard.module.css";

/**
 * The owner's analytics settings (ticket 17): the reporting time zone day
 * boundaries are drawn in, and how long analytics rows are kept. There is no
 * "off" — reporting always runs somewhere and always expires — so the form
 * saves both values together.
 */
export default function AnalyticsSettingsForm({
  initial,
  onSaved,
}: {
  initial: { reportingTimeZone: string; retentionDays: number };
  onSaved: () => void;
}) {
  const [timeZone, setTimeZone] = useState(initial.reportingTimeZone);
  const [days, setDays] = useState(String(initial.retentionDays));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) {
      return;
    }
    const parsed = Number(days);
    if (!isValidRetentionDays(parsed)) {
      setMessage(
        `Enter a whole number of days between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS}.`,
      );
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/staff/settings/analytics", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportingTimeZone: timeZone.trim(), retentionDays: parsed }),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setMessage(failure?.error?.message ?? "Could not save the analytics settings.");
        return;
      }
      setMessage("Analytics settings saved.");
      onSaved();
    } catch {
      setMessage("Could not save the analytics settings.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.ruleCard} onSubmit={submit}>
      <h2>Analytics settings</h2>
      <p className={styles.hint}>
        Day boundaries in reports follow this IANA time zone (for example
        Asia/Singapore). Analytics rows — anonymous presence and daily counts —
        are removed once they are this many days old. Counts never involve IP
        addresses, emails, or chat content.
      </p>
      <label htmlFor="analytics-timezone">Reporting time zone</label>
      <input
        id="analytics-timezone"
        type="text"
        value={timeZone}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setTimeZone(event.target.value)}
      />
      <label htmlFor="analytics-retention">Keep analytics for (days)</label>
      <input
        id="analytics-retention"
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
          Save settings
        </button>
      </div>
      {message ? (
        <p className={styles.hint} role="status">
          {message}
        </p>
      ) : null}
    </form>
  );
}
