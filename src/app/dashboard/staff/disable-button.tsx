"use client";

import { useRef, useState } from "react";
import { useStaffAction } from "../use-staff-action";
import ConfirmDialog from "../confirm-dialog";
import styles from "../dashboard.module.css";

/**
 * Owner-side account disable (ticket 08), confirmed through the shared
 * modal since ticket 51 introduced it — the browser's confirm popup is gone
 * from the dashboard. The disable action itself is unchanged; the "Disabling…"
 * pending verb lives on the dialog's confirm control while the request runs.
 */
export default function DisableButton({ memberId, name }: { memberId: string; name: string }) {
  const staff = useStaffAction();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  function close() {
    setOpen(false);
    staff.setError("");
    triggerRef.current?.focus();
  }

  async function confirm() {
    const result = await staff.run(
      () => fetch(`/api/staff/members/${memberId}/disable`, { method: "POST" }),
      "Could not disable the account.",
    );
    if (!result.ok) {
      // The dialog stays open; the inline error explains the refusal.
      return;
    }
    close();
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
          pending={staff.busy}
          error={staff.error}
          onConfirm={() => void confirm()}
          onCancel={close}
        >
          <p>Their access ends immediately.</p>
        </ConfirmDialog>
      ) : null}
    </span>
  );
}
