"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../dashboard.module.css";

export default function RetryButton({ notificationId }: { notificationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  return (
    <span>
      <button
        type="button"
        className={styles.signOut}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage("");
          const response = await fetch(`/api/staff/notifications/${notificationId}/retry`, {
            method: "POST",
          });
          setBusy(false);
          if (response.ok) {
            router.refresh();
          } else {
            const body = (await response.json().catch(() => null)) as {
              error?: { message?: string };
            } | null;
            setMessage(body?.error?.message ?? "Retry failed.");
          }
        }}
      >
        Retry delivery
      </button>
      {message ? <span className={styles.error}> {message}</span> : null}
    </span>
  );
}
