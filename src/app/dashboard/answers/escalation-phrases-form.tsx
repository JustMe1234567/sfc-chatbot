"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../dashboard.module.css";

/**
 * Editor configuration of the handoff phrases: any question containing one
 * of these phrases goes straight to staff, even when a rule also matches.
 * Saving applies from the next question; an empty list turns the feature
 * off (unknown questions still offer a visitor-consented handoff).
 */
export default function EscalationPhrasesForm({ initialPhrases }: { initialPhrases: string[] }) {
  const router = useRouter();
  const [value, setValue] = useState(initialPhrases.join("\n"));
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
        const phrases = value
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        const response = await fetch("/api/staff/settings/escalation-phrases", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phrases }),
        });
        setBusy(false);
        if (response.ok) {
          setMessage("Handoff phrases saved.");
          router.refresh();
        } else {
          const failure = (await response.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          setMessage(failure?.error?.message ?? "Could not save the phrases.");
        }
      }}
    >
      <h2>Handoff phrases</h2>
      <p className={styles.hint}>
        One phrase per line. A question containing a phrase goes to staff
        immediately, even when an answer rule also matches.
      </p>
      <label htmlFor="escalation-phrases">Phrases</label>
      <textarea
        id="escalation-phrases"
        rows={3}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit" disabled={busy}>
        Save phrases
      </button>
      {message ? (
        <p className={styles.hint} role="status">
          {message}
        </p>
      ) : null}
    </form>
  );
}
