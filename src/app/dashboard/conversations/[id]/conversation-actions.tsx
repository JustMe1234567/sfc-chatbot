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

export function ReleaseAndTransfer({
  conversationId,
  targets,
}: {
  conversationId: string;
  targets: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [target, setTarget] = useState(targets[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function post(action: "release" | "transfer", body?: unknown) {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/staff/conversations/${conversationId}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    setBusy(false);
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
      <button
        type="button"
        className={styles.secondaryButton}
        disabled={busy}
        onClick={() => void post("release")}
      >
        Release to inbox
      </button>
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
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={busy || target.length === 0}
            onClick={() => void post("transfer", { to: target })}
          >
            Transfer
          </button>
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
