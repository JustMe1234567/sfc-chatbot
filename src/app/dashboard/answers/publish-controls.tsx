"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AnswerRuleStatus } from "@/domain/types";
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
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const published = status === "published";

  async function act(): Promise<void> {
    if (busy) {
      return;
    }
    setBusy(true);
    setMessage("");
    const result = await fetch(
      `/api/staff/answer-rules/${ruleId}/${published ? "unpublish" : "publish"}`,
      { method: "POST" },
    );
    setBusy(false);
    if (!result.ok) {
      const failure = (await result.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setMessage(failure?.error?.message ?? "That did not work.");
      return;
    }
    router.refresh();
  }

  return (
    <div className={styles.publishBar}>
      <button type="button" className={styles.secondaryButton} disabled={busy} onClick={act}>
        {published ? "Unpublish" : "Publish"}
      </button>
      <span className={styles.hint}>
        {published
          ? "Published: answering visitors now."
          : "Draft: not answering visitors until published."}
      </span>
      {message ? (
        <span className={styles.hint} role="alert">
          {message}
        </span>
      ) : null}
    </div>
  );
}
