"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
      <button
        type="button"
        className={styles.secondaryButton}
        disabled={busy}
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
            setError(body?.error?.message ?? "Claim failed.");
          }
          setBusy(false);
        }}
      >
        Claim conversation
      </button>
      {error ? (
        <span className={styles.error} role="alert">
          {" "}
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submitReply(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed.length === 0 || busy) {
      return;
    }
    setBusy(true);
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
    setBusy(false);
  }

  async function close() {
    setBusy(true);
    const response = await post("close", conversationId);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(body?.error?.message ?? "Close failed.");
    }
    router.refresh();
    setBusy(false);
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
        <button type="submit" disabled={busy || text.trim().length === 0}>
          Send reply
        </button>
      </form>
      <button type="button" className={styles.secondaryButton} onClick={close} disabled={busy}>
        Close conversation
      </button>
      {error ? (
        <span className={styles.error} role="alert">
          {" "}
          {error}
        </span>
      ) : null}
    </div>
  );
}
