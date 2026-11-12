"use client";

import { useStaffAction } from "../use-staff-action";
import PendingButton from "../pending-button";
import styles from "../dashboard.module.css";

export default function RetryButton({ notificationId }: { notificationId: string }) {
  const staff = useStaffAction();

  return (
    <span>
      <PendingButton
        type="button"
        className={styles.retryButton}
        pending={staff.busy}
        pendingLabel="Retrying…"
        onClick={async () => {
          await staff.run(
            () => fetch(`/api/staff/notifications/${notificationId}/retry`, { method: "POST" }),
            "Retry failed.",
          );
        }}
      >
        Retry delivery
      </PendingButton>
      {staff.error ? <span className={styles.error}> {staff.error}</span> : null}
    </span>
  );
}
