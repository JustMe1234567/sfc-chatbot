"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "../confirm-dialog";
import styles from "../dashboard.module.css";

/**
 * Owner-side account disable (ticket 08), confirmed through the shared
 * modal since ticket 51 introduced it — the browser's confirm popup is gone
 * from the dashboard. The disable action itself is unchanged; the "Disabling…"
 * pending verb lives on the dialog's confirm control while the request runs.
 */
export default function DisableButton({ memberId, name }: { memberId: string; name: string }) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function close() {
    setOpen(false);
    setError("");
    triggerRef.current?.focus();
  }

  async function confirm() {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/staff/members/${memberId}/disable`, {
      method: "POST",
    });
    setBusy(false);
    if (!response.ok) {
      const failure = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(failure?.error?.message ?? "Could not disable the account.");
      return;
    }
    close();
    router.refresh();
  }

  return (
    <span className={styles.publishBar}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.secondaryButton}
        onClick={() => setOpen(true)}
      >
        Disable
      </button>
      {open ? (
        <ConfirmDialog
          title={`Disable ${name}?`}
          confirmLabel="Disable"
          pendingLabel="Disabling…"
          pending={busy}
          error={error}
          onConfirm={() => void confirm()}
          onCancel={close}
        >
          <p>Their access ends immediately.</p>
        </ConfirmDialog>
      ) : null}
    </span>
  );
}
