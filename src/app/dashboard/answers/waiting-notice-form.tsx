"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_WAITING_NOTICE_LENGTH } from "@/domain/waitingNotice";
import PendingButton from "../pending-button";
import styles from "../dashboard.module.css";

/**
 * Configuration of the handoff waiting notice (ticket 103), following the
 * welcome-message pattern (ticket 41): the small, centered line inside the
 * transcript shown while an advisor is joining. Saving applies from the
 * visitor's next widget open — no redeploy. An empty value is refused;
 * unconfigured states fall back to the built-in default.
 */
export default function WaitingNoticeForm({ initialText }: { initialText: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialText);
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
        const response = await fetch("/api/staff/settings/waiting-notice", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: value }),
        });
        setBusy(false);
        if (response.ok) {
          setValue(((await response.json()) as { text: string }).text);
          setMessage("Waiting notice saved.");
          router.refresh();
        } else {
          const failure = (await response.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          setMessage(failure?.error?.message ?? "Could not save the waiting notice.");
        }
      }}
    >
      <h2>Waiting notice</h2>
      <p className={styles.hint}>
        Shown inside the chat while a visitor waits for an advisor to join.
        It never becomes part of the saved transcript.
      </p>
      <label htmlFor="waiting-notice">Notice</label>
      <textarea
        id="waiting-notice"
        rows={2}
        maxLength={MAX_WAITING_NOTICE_LENGTH}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <PendingButton type="submit" pending={busy} pendingLabel="Saving…">
        Save waiting notice
      </PendingButton>
      {message ? (
        <p className={styles.hint} role="status">
          {message}
        </p>
      ) : null}
    </form>
  );
}
