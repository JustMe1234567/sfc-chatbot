"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PendingButton from "../pending-button";
import styles from "../dashboard.module.css";

/**
 * Editor configuration of the click-to-handoff options (ticket 67): each
 * option appears as a clickable button in the chat; clicking one records it
 * as the visitor's words, notifies staff, and pauses automated answers.
 * Deliberately separate from the typed Handoff phrases — typing the same
 * wording still follows normal answer matching; only the click hands off.
 */
export default function HandoffOptionsForm({ initialOptions }: { initialOptions: string[] }) {
  const router = useRouter();
  const [value, setValue] = useState(initialOptions.join("\n"));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className={styles.ruleCard}
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) {
          return;
        }
        setBusy(true);
        setMessage("");
        const options = value
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        const response = await fetch("/api/staff/settings/handoff-options", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ options }),
        });
        setBusy(false);
        if (response.ok) {
          setMessage("Handoff options saved.");
          router.refresh();
        } else {
          const failure = (await response.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          setMessage(failure?.error?.message ?? "Could not save the options.");
        }
      }}
    >
      <h2>Handoff options</h2>
      <p className={styles.hint}>
        One option per line, shown in this order. Each appears as a clickable
        button in the chat; clicking one sends the visitor straight to an advisor
        and pauses automated answers. Typing the same wording still follows
        normal answer matching.
      </p>
      <label htmlFor="handoff-options">Options</label>
      <textarea
        id="handoff-options"
        rows={3}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <PendingButton type="submit" pending={busy} pendingLabel="Saving…">
        Save options
      </PendingButton>
      {message ? (
        <p className={styles.hint} role="status">
          {message}
        </p>
      ) : null}
    </form>
  );
}
