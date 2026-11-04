"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PendingButton from "../../pending-button";
import styles from "../../dashboard.module.css";

async function post(action: "claim" | "close", conversationId: string) {
  const response = await fetch(`/api/staff/conversations/${conversationId}/${action}`, {
    method: "POST",
  });
  return response;
}

export function ClaimButton({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div>
      <PendingButton
        type="button"
        className={styles.primaryButton}
        pending={busy}
        pendingLabel="Taking over…"
        onClick={async () => {
          setBusy(true);
          setError("");
          const response = await post("claim", conversationId);
          if (response.ok) {
            router.refresh();
          } else {
            const body = (await response.json().catch(() => null)) as {
              error?: { message?: string };
            } | null;
            setError(body?.error?.message ?? "Take over failed.");
          }
          setBusy(false);
        }}
      >
        Take over
      </PendingButton>
      {error ? (
        <span className={styles.error} role="alert">
          {" "}
          {error}
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
  const router = useRouter();
  const [target, setTarget] = useState(targets[0]?.id ?? "");
  // Which action is in flight, so each button names its own verb (ticket 42).
  const [pendingAction, setPendingAction] = useState<"release" | "transfer" | null>(null);
  const [error, setError] = useState("");

  async function post(action: "release" | "transfer", body?: unknown) {
    setPendingAction(action);
    setError("");
    const response = await fetch(`/api/staff/conversations/${conversationId}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    setPendingAction(null);
    if (response.ok) {
      router.refresh();
      return true;
    }
    const failure = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    setError(failure?.error?.message ?? "That did not work.");
    return false;
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
      {error ? (
        <span className={styles.error} role="alert">
          {error}
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
  const [text, setText] = useState("");
  const [pendingAction, setPendingAction] = useState<"reply" | "close" | null>(null);
  const [error, setError] = useState("");

  async function submitReply(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed.length === 0 || pendingAction) {
      return;
    }
    setPendingAction("reply");
    setError("");
    const response = await fetch(`/api/staff/conversations/${conversationId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: trimmed }),
    });
    if (response.ok) {
      setText("");
      router.refresh();
    } else {
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(body?.error?.message ?? "Reply failed.");
    }
    setPendingAction(null);
  }

  async function close() {
    setPendingAction("close");
    const response = await post("close", conversationId);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(body?.error?.message ?? "Close failed.");
    }
    router.refresh();
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
      {error ? (
        <span className={styles.error} role="alert">
          {" "}
          {error}
        </span>
      ) : null}
    </div>
  );
}
