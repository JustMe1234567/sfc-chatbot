"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PendingButton from "../pending-button";
import styles from "../dashboard.module.css";

/** Owner-only configuration of the staff alert destination. */
export default function AlertSettingsForm({ initialRecipients }: { initialRecipients: string[] }) {
  const router = useRouter();
  const [value, setValue] = useState(initialRecipients.join(", "));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className={styles.loginCard}
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage("");
        const recipients = value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        const response = await fetch("/api/staff/settings/alert-recipients", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipients }),
        });
        setBusy(false);
        if (response.ok) {
          setMessage("Alert recipients saved.");
          router.refresh();
        } else {
          const body = (await response.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          setMessage(body?.error?.message ?? "Could not save recipients.");
        }
      }}
    >
      <h2>Staff alert recipients</h2>
      <p className={styles.hint}>
        Comma-separated email addresses. Each conversation sends one alert to
        every address on this list.
      </p>
      <label htmlFor="recipients">Alert recipients</label>
      <input
        id="recipients"
        type="text"
        autoComplete="off"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <PendingButton type="submit" pending={busy} pendingLabel="Saving…">
        Save recipients
      </PendingButton>
      {message ? (
        <p className={styles.hint} role="status">
          {message}
        </p>
      ) : null}
    </form>
  );
}
