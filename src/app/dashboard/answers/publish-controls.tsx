"use client";

import type { AnswerRuleStatus } from "@/domain/types";
import { useStaffAction } from "../use-staff-action";
import PendingButton from "../pending-button";
import styles from "../dashboard.module.css";

/**
 * The review act: publishing puts the saved content in front of visitors
 * under the current editor's name; unpublishing withdraws it. Both take
 * effect on the visitor's next question, without a redeploy.
 */
export default function PublishControls({
  ruleId,
  status,
}: {
  ruleId: string;
  status: AnswerRuleStatus;
}) {
  const staff = useStaffAction();
  const published = status === "published";

  async function act(): Promise<void> {
    if (staff.busy) {
      return;
    }
    await staff.run(
      () =>
        fetch(`/api/staff/answer-rules/${ruleId}/${published ? "unpublish" : "publish"}`, {
          method: "POST",
        }),
      "That did not work.",
    );
  }

  return (
    <div className={styles.publishBar}>
      <PendingButton
        type="button"
        className={styles.secondaryButton}
        pending={staff.busy}
        pendingLabel={published ? "Unpublishing…" : "Publishing…"}
        onClick={act}
      >
        {published ? "Unpublish" : "Publish"}
      </PendingButton>
      <span className={styles.hint}>
        {published
          ? "Published: answering visitors now."
          : "Draft: not answering visitors until published."}
      </span>
      {staff.error ? (
        <span className={styles.hint} role="alert">
          {staff.error}
        </span>
      ) : null}
    </div>
  );
}
