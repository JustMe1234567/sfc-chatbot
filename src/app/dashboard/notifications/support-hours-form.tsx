"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clockLabel } from "@/domain/hours";
import type { SupportHours } from "@/domain/types";
import PendingButton from "../pending-button";
import styles from "../dashboard.module.css";

const DAY_LABELS: [number, string][] = [
  [0, "Sun"],
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
];

function timeToMinutes(value: string): number | null {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Owner configuration of the staff desk's open hours (ticket 09). The
 * handoff wording visitors receive is composed from this setting at reply
 * time; clearing it returns the promise-free general message.
 */
export default function SupportHoursForm({ initialHours }: { initialHours: SupportHours | null }) {
  const router = useRouter();
  const [timeZone, setTimeZone] = useState(initialHours?.timeZone ?? "");
  const [days, setDays] = useState<number[]>(initialHours?.days ?? [1, 2, 3, 4, 5]);
  // A closing time of midnight (24:00) has no valid <input type="time">
  // spelling; the form shows 23:59 instead, and re-saving narrows the window
  // by that one minute.
  const [start, setStart] = useState(clockLabel(initialHours?.startMinute ?? 9 * 60));
  const [end, setEnd] = useState(
    clockLabel(Math.min(initialHours?.endMinute ?? 17 * 60, 23 * 60 + 59)),
  );
  const [message, setMessage] = useState("");
  // Which action is in flight, so each button names its own verb (ticket 42).
  const [pendingAction, setPendingAction] = useState<"save" | "clear" | null>(null);

  async function save(hours: SupportHours | null) {
    setPendingAction(hours === null ? "clear" : "save");
    setMessage("");
    const response = await fetch("/api/staff/settings/support-hours", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hours }),
    });
    setPendingAction(null);
    if (response.ok) {
      setMessage(hours ? "Support hours saved." : "Support hours cleared; visitors get the general message.");
      router.refresh();
    } else {
      const failure = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setMessage(failure?.error?.message ?? "Could not save the hours.");
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pendingAction || timeZone.trim().length === 0 || days.length === 0) {
      return;
    }
    const startMinute = timeToMinutes(start);
    const endMinute = timeToMinutes(end);
    if (startMinute === null || endMinute === null || endMinute <= startMinute) {
      setMessage("The closing time must be after the opening time.");
      return;
    }
    await save({
      timeZone: timeZone.trim(),
      days: [...days].sort((a, b) => a - b),
      startMinute,
      endMinute,
    });
  }

  return (
    <form
      className={`${styles.ruleCard} ${styles.alertSettingsCard} ${styles.supportHoursCard}`}
      onSubmit={submit}
    >
      <h2>Support hours</h2>
      <p className={styles.hint}>
        Visitors are told when staff are on duty at handoff. Leave empty for a
        general follow-up message that promises no response time.
      </p>
      <div className={styles.formField}>
        <label htmlFor="hours-zone">Time zone</label>
        <p className={styles.fieldHelp} id="hours-zone-help">
          Use an IANA name, such as Europe/London.
        </p>
        <input
          id="hours-zone"
          type="text"
          value={timeZone}
          placeholder="Europe/London"
          aria-describedby="hours-zone-help"
          onChange={(event) => setTimeZone(event.target.value)}
        />
      </div>
      <fieldset className={styles.dayPicker}>
        <legend>Open days</legend>
        <div className={styles.dayPickerOptions}>
          {DAY_LABELS.map(([value, label]) => (
            <label key={value} className={styles.dayChoice}>
              <input
                type="checkbox"
                checked={days.includes(value)}
                onChange={(event) =>
                  setDays((current) =>
                    event.target.checked
                      ? [...current, value]
                      : current.filter((day) => day !== value),
                  )
                }
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className={styles.timeFields}>
        <div className={styles.formField}>
          <label htmlFor="hours-start">Opening time</label>
          <input
            id="hours-start"
            type="time"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </div>
        <div className={styles.formField}>
          <label htmlFor="hours-end">Closing time</label>
          <input
            id="hours-end"
            type="time"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
        </div>
      </div>
      <div className={styles.formActions}>
        <PendingButton
          type="submit"
          pending={pendingAction === "save"}
          pendingLabel="Saving…"
          disabled={pendingAction === "clear" || timeZone.trim().length === 0 || days.length === 0}
        >
          Save hours
        </PendingButton>
        <PendingButton
          type="button"
          className={styles.secondaryButton}
          pending={pendingAction === "clear"}
          pendingLabel="Clearing…"
          disabled={pendingAction === "save"}
          onClick={() => void save(null)}
        >
          Clear
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
