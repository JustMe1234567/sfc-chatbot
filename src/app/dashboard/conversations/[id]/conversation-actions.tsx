"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PendingButton from "../../pending-button";
import { useStaffAction } from "../../use-staff-action";
import styles from "../../dashboard.module.css";

async function post(action: "claim" | "close" | "mark-contacted", conversationId: string) {
  const response = await fetch(`/api/staff/conversations/${conversationId}/${action}`, {
    method: "POST",
  });
  return response;
}

/**
 * Completes the conversation's open email or phone contact request
 * (ticket 69): the staff member reached the visitor outside the chat. The
 * desk's persistent Contact Me clears with the refresh; nothing is added
 * to the visitor's transcript.
 */
export function MarkContactedButton({ conversationId }: { conversationId: string }) {
  const staff = useStaffAction();
  return (
    <div>
      <PendingButton
        type="button"
        className={styles.primaryButton}
        pending={staff.busy}
        pendingLabel="Marking…"
        onClick={async () => {
          await staff.run(() => post("mark-contacted", conversationId), "Could not mark contacted.");
        }}
      >
        Mark contacted
      </PendingButton>
      {staff.error ? (
        <span className={styles.error} role="alert">
          {" "}
          {staff.error}
        </span>
      ) : null}
    </div>
  );
}

export function ClaimButton({ conversationId }: { conversationId: string }) {
  const staff = useStaffAction();
  return (
    <div>
      <PendingButton
        type="button"
        className={styles.primaryButton}
        pending={staff.busy}
        pendingLabel="Taking over…"
        onClick={async () => {
          await staff.run(() => post("claim", conversationId), "Take over failed.");
        }}
      >
        Take over
      </PendingButton>
      {staff.error ? (
        <span className={styles.error} role="alert">
          {" "}
          {staff.error}
        </span>
      ) : null}
    </div>
  );
}

export function ReleaseAndTransfer({
  conversationId,
  targets,
}: {
  conversationId: string;
  targets: { id: string; name: string }[];
}) {
  const staff = useStaffAction();
  const [target, setTarget] = useState(targets[0]?.id ?? "");
  // Which action is in flight, so each button names its own verb (ticket 42).
  const [pendingAction, setPendingAction] = useState<"release" | "transfer" | null>(null);

  async function post(action: "release" | "transfer", body?: unknown) {
    setPendingAction(action);
    const result = await staff.run(
      () =>
        fetch(`/api/staff/conversations/${conversationId}/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        }),
      "That did not work.",
    );
    setPendingAction(null);
    return result.ok;
  }

  return (
    <div className={styles.publishBar}>
      <PendingButton
        type="button"
        className={styles.secondaryButton}
        pending={pendingAction === "release"}
        pendingLabel="Releasing…"
        disabled={pendingAction === "transfer"}
        onClick={() => void post("release")}
      >
        Release to inbox
      </PendingButton>
      {targets.length > 0 ? (
        <>
          <label className={styles.srOnly} htmlFor="transfer-target">
            Transfer to
          </label>
          <select
            id="transfer-target"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            {targets.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
          <PendingButton
            type="button"
            className={styles.secondaryButton}
            pending={pendingAction === "transfer"}
            pendingLabel="Transferring…"
            disabled={pendingAction === "release" || target.length === 0}
            onClick={() => void post("transfer", { to: target })}
          >
            Transfer
          </PendingButton>
        </>
      ) : null}
      {staff.error ? (
        <span className={styles.error} role="alert">
          {staff.error}
        </span>
      ) : null}
    </div>
  );
}

export function ReplyAndClose({
  conversationId,
}: {
  conversationId: string;
}) {
  const router = useRouter();
  const staff = useStaffAction();
  const [text, setText] = useState("");
  // Which action is in flight, so each button names its own verb (ticket 42).
  const [pendingAction, setPendingAction] = useState<"reply" | "close" | null>(null);

  async function submitReply(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed.length === 0 || pendingAction) {
      return;
    }
    setPendingAction("reply");
    const result = await staff.run(
      () =>
        fetch(`/api/staff/conversations/${conversationId}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: trimmed }),
        }),
      "Reply failed.",
    );
    if (result.ok) {
      setText("");
    }
    setPendingAction(null);
  }

  async function close() {
    setPendingAction("close");
    const result = await staff.run(
      () => post("close", conversationId),
      "Close failed.",
    );
    // The close always refreshed, success or failure — preserved (ticket 33).
    if (!result.ok) {
      router.refresh();
    }
    setPendingAction(null);
  }

  return (
    <div className={styles.replyArea}>
      <form className={styles.replyForm} onSubmit={submitReply}>
        <label className={styles.srOnly} htmlFor="staff-reply">
          Your reply to the visitor
        </label>
        <textarea
          id="staff-reply"
          rows={2}
          maxLength={1000}
          placeholder="Type your reply to the visitor"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <PendingButton
          type="submit"
          pending={pendingAction === "reply"}
          pendingLabel="Sending…"
          disabled={(pendingAction !== null && pendingAction !== "reply") || text.trim().length === 0}
        >
          Send reply
        </PendingButton>
      </form>
      <PendingButton
        type="button"
        className={styles.dangerButton}
        pending={pendingAction === "close"}
        pendingLabel="Closing…"
        disabled={pendingAction === "reply"}
        onClick={close}
      >
        Close conversation
      </PendingButton>
      {staff.error ? (
        <span className={styles.error} role="alert">
          {" "}
          {staff.error}
        </span>
      ) : null}
    </div>
  );
}
