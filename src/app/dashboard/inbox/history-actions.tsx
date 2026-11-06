"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "../confirm-dialog";
import styles from "../dashboard.module.css";

/**
 * The History tab's destructive controls (ticket 51). Both open the shared
 * confirmation dialog before touching anything, surface failures inline in
 * the dialog, and hand focus back to their trigger on close. Deleting the
 * conversation whose transcript is open — or clearing history beneath one —
 * navigates back to the History list rather than leaving a dead pane.
 */

type PostResult = { ok: true } | { ok: false; message: string };

async function postJson(url: string): Promise<PostResult> {
  const response = await fetch(url, { method: "POST" });
  if (response.ok) {
    return { ok: true };
  }
  const failure = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return { ok: false, message: failure?.error?.message ?? "This could not be completed." };
}

export function DeleteConversationButton({
  conversationId,
  selected,
  description,
}: {
  conversationId: string;
  selected: boolean;
  description: string;
}) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  function close() {
    setOpen(false);
    setError("");
    // Focus returns to the control that opened the dialog.
    triggerRef.current?.focus();
  }

  async function confirm() {
    setPending(true);
    setError("");
    const result = await postJson(`/api/staff/conversations/${conversationId}/delete`);
    setPending(false);
    if (!result.ok) {
      // The dialog stays open; the inline error explains the refusal.
      setError(result.message);
      return;
    }
    close();
    if (selected) {
      await router.push("/dashboard/inbox/history");
    } else {
      router.refresh();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.rowDeleteButton}
        aria-label="Delete this conversation"
        onClick={() => setOpen(true)}
      >
        Delete
      </button>
      {open ? (
        <ConfirmDialog
          title="Delete this conversation?"
          confirmLabel="Delete"
          pendingLabel="Deleting…"
          pending={pending}
          error={error}
          onConfirm={() => void confirm()}
          onCancel={close}
        >
          <p>
            This permanently removes the conversation and its transcript,
            including the visitor&apos;s contact details. Any History
            conversation can be deleted, closed or inactive. This cannot be
            undone. Conversation being deleted: {description}.
          </p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

export function ClearHistoryButton({
  count,
  selectedId,
}: {
  count: number;
  selectedId: string | null;
}) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  function close() {
    setOpen(false);
    setError("");
    triggerRef.current?.focus();
  }

  async function confirm() {
    setPending(true);
    setError("");
    const result = await postJson("/api/staff/conversations/clear-history");
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    close();
    if (selectedId) {
      await router.push("/dashboard/inbox/history");
    } else {
      router.refresh();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.clearHistoryButton}
        onClick={() => setOpen(true)}
      >
        Clear history
      </button>
      {open ? (
        <ConfirmDialog
          title="Clear history?"
          confirmLabel="Clear history"
          pendingLabel="Clearing…"
          pending={pending}
          error={error}
          onConfirm={() => void confirm()}
          onCancel={close}
        >
          <p>
            This permanently removes {count} History conversation
            {count === 1 ? "" : "s"}, closed or inactive — their transcripts
            and visitor contact details cannot be recovered. Live
            conversations on the Conversations tab are kept.
          </p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
