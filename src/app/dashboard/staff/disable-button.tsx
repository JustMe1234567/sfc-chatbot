"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../dashboard.module.css";

/** Owner-side account disable (ticket 08): immediate, with confirmation. */
export default function DisableButton({ memberId, name }: { memberId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <span className={styles.publishBar}>
      <button
        type="button"
        className={styles.secondaryButton}
        disabled={busy}
        onClick={async () => {
          if (busy || !window.confirm(`Disable ${name}? Their access ends immediately.`)) {
            return;
          }
          setBusy(true);
          setError("");
          const response = await fetch(`/api/staff/members/${memberId}/disable`, {
            method: "POST",
          });
          setBusy(false);
          if (response.ok) {
            router.refresh();
          } else {
            const failure = (await response.json().catch(() => null)) as {
              error?: { message?: string };
            } | null;
            setError(failure?.error?.message ?? "Could not disable the account.");
          }
        }}
      >
        Disable
      </button>
      {error ? (
        <span className={styles.hint} role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
