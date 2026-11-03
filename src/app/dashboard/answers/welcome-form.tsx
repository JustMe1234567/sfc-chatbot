"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_WELCOME_LENGTH } from "@/domain/welcome";
import styles from "../dashboard.module.css";

/**
 * Editor configuration of the fresh-chat greeting (ticket 41): the wording
 * a visitor sees at the top of a new conversation, before asking anything.
 * Saving applies from the visitor's next fresh widget open — no redeploy.
 */
export default function WelcomeForm({ initialText }: { initialText: string }) {
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
        const response = await fetch("/api/staff/settings/welcome", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: value }),
        });
        setBusy(false);
        if (response.ok) {
          setValue(((await response.json()) as { text: string }).text);
          setMessage("Welcome message saved.");
          router.refresh();
        } else {
          const failure = (await response.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          setMessage(failure?.error?.message ?? "Could not save the welcome message.");
        }
      }}
    >
      <h2>Welcome message</h2>
      <p className={styles.hint}>
        Shown at the top of a fresh chat before the visitor asks anything.
        It is a greeting only — it never becomes part of the saved transcript.
      </p>
      <label htmlFor="welcome-message">Greeting</label>
      <textarea
        id="welcome-message"
        rows={2}
        maxLength={MAX_WELCOME_LENGTH}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit" disabled={busy}>
        Save welcome message
      </button>
      {message ? (
        <p className={styles.hint} role="status">
          {message}
        </p>
      ) : null}
    </form>
  );
}
