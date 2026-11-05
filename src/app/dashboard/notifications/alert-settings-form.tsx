"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { isValidRecipientEmail } from "@/settings";
import PendingButton from "../pending-button";
import styles from "../dashboard.module.css";

/**
 * Owner configuration of the staff alert destination, one box per address
 * (ticket 54). Every action — add, edit-save, delete — applies immediately
 * and persists the resulting whole list through the unchanged
 * `PUT /api/staff/settings/alert-recipients`; the acting row shows the
 * ticket-42 pending treatment and reverts with an inline server error if
 * the save fails. The API and its 1–10 validation stay the source of truth.
 *
 * Other boxes stay interactive while one request is in flight, so the PUTs
 * are serialized through a promise queue: each queued action recomputes
 * from the latest list (mirrored in a ref), meaning no in-flight save can
 * be clobbered by the next one and the list always settles to the last
 * saved state.
 */

type PendingAction =
  | { kind: "add" }
  | { kind: "edit"; index: number }
  | { kind: "delete"; index: number };

type ErrorAt = { at: "add" | number; message: string };

type FocusRequest = { kind: "row"; index: number } | { kind: "add" };

/** Inline marks on the ticket-52 grid: stroke-only, currentColor. */
function Mark({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const PENCIL = (
  <Mark>
    <path d="M4 20l1-4L16.5 4.5a1.5 1.5 0 0 1 2.1 0l.9.9a1.5 1.5 0 0 1 0 2.1L8 19z" />
    <path d="M14.5 6.5l3 3" />
  </Mark>
);

const TRASH = (
  <Mark>
    <path d="M4.5 6.5h15" />
    <path d="M8 6.5V4.8A1.3 1.3 0 0 1 9.3 3.5h5.4A1.3 1.3 0 0 1 16 4.8v1.7" />
    <path d="M6.5 6.5l.8 12a1.3 1.3 0 0 0 1.3 1.2h6.8a1.3 1.3 0 0 0 1.3-1.2l.8-12" />
    <path d="M10 10.5v5" />
    <path d="M14 10.5v5" />
  </Mark>
);

export default function AlertSettingsForm({ initialRecipients }: { initialRecipients: string[] }) {
  const router = useRouter();
  const [recipients, setRecipients] = useState(initialRecipients);
  const [addValue, setAddValue] = useState("");
  const [editing, setEditing] = useState<{ index: number; value: string } | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [error, setError] = useState<ErrorAt | null>(null);
  const [status, setStatus] = useState("");
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const editRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // The latest list for queued work: a runner reads this rather than a
  // state closure captured before its turn came up.
  const recipientsRef = useRef(recipients);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    recipientsRef.current = recipients;
  }, [recipients]);

  // Focus is restored after the list settles: to a neighbouring box after a
  // delete (or the Add area when the stack emptied to the hint state), and
  // to the row's own Edit control after an edit-save or cancel.
  useEffect(() => {
    if (!focusRequest) {
      return;
    }
    if (focusRequest.kind === "add") {
      addInputRef.current?.focus();
    } else {
      const target = editRefs.current[focusRequest.index];
      if (target) {
        target.focus();
      } else {
        addInputRef.current?.focus();
      }
    }
    setFocusRequest(null);
  }, [focusRequest, recipients]);

  /** Client-side half of the API's rules, run before anything is sent. */
  function validate(value: string, current: string[], indexToIgnore: number | null): string | null {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return "Enter an email address.";
    }
    if (!isValidRecipientEmail(trimmed)) {
      return "That doesn't look like an email address.";
    }
    if (
      current.some(
        (existing, index) =>
          index !== indexToIgnore && existing.toLowerCase() === trimmed.toLowerCase(),
      )
    ) {
      return "That address is already on the list.";
    }
    return null;
  }

  /**
   * Enqueues one mutation on the serialized queue. The runner recomputes
   * from the latest list, applies `next` optimistically, and persists the
   * whole list. On success the list settles to the server's saved copy; on
   * failure it reverts to the snapshot and the acting row shows the
   * server's message inline.
   */
  function enqueueMutation(
    acting: PendingAction,
    compute: (current: string[]) => string[] | { problem: string },
  ): Promise<boolean> {
    const run = queueRef.current.then(
      () =>
        new Promise<boolean>((resolve) => {
          const current = recipientsRef.current;
          const result = compute(current);
          if (typeof result === "object" && "problem" in result) {
            setError({
              at: acting.kind === "add" ? "add" : acting.index,
              message: result.problem,
            });
            resolve(false);
            return;
          }
          const next = result;
          setPending(acting);
          setError(null);
          setStatus("");
          setRecipients(next);
          fetch("/api/staff/settings/alert-recipients", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ recipients: next }),
          })
            .then(async (response) => {
              const body = (await response.json().catch(() => null)) as {
                recipients?: string[];
                error?: { message?: string };
              } | null;
              setPending(null);
              if (!response.ok) {
                setRecipients(current);
                setError({
                  at: acting.kind === "add" ? "add" : acting.index,
                  message: body?.error?.message ?? "Could not save the recipients.",
                });
                resolve(false);
                return;
              }
              setRecipients(body?.recipients ?? next);
              setStatus("Alert recipients saved.");
              router.refresh();
              resolve(true);
            })
            .catch(() => {
              setPending(null);
              setRecipients(current);
              setError({
                at: acting.kind === "add" ? "add" : acting.index,
                message: "Could not save the recipients.",
              });
              resolve(false);
            });
        }),
    );
    queueRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function beginEdit(index: number) {
    const value = recipients[index];
    if (value === undefined) {
      return;
    }
    setError(null);
    setStatus("");
    setEditing({ index, value });
  }

  function cancelEdit() {
    const index = editing?.index;
    setEditing(null);
    if (index !== undefined) {
      setFocusRequest({ kind: "row", index });
    }
  }

  async function saveEdit() {
    if (!editing) {
      return;
    }
    const index = editing.index;
    const value = editing.value;
    const saved = await enqueueMutation({ kind: "edit", index }, (current) => {
      const trimmed = value.trim();
      const problem = validate(trimmed, current, index);
      if (problem) {
        // Stays in edit mode with the message inline; nothing is saved.
        return { problem };
      }
      return current.map((existing, position) =>
        position === index ? trimmed : existing,
      );
    });
    if (saved) {
      setEditing(null);
      setFocusRequest({ kind: "row", index });
    }
  }

  async function remove(index: number) {
    // Captured before the await so a mid-flight edit cannot skew the
    // post-delete adjustment below.
    const editingAtCall = editing;
    const saved = await enqueueMutation({ kind: "delete", index }, (current) =>
      current.filter((_, position) => position !== index),
    );
    if (!saved) {
      return;
    }
    // Row indexes shifted under an open editor; re-point or close it.
    if (editingAtCall) {
      if (editingAtCall.index === index) {
        setEditing(null);
      } else if (editingAtCall.index > index) {
        setEditing({ ...editingAtCall, index: editingAtCall.index - 1 });
      }
    }
    const target = Math.min(index, recipientsRef.current.length - 1);
    setFocusRequest(target >= 0 ? { kind: "row", index: target } : { kind: "add" });
  }

  async function add() {
    const value = addValue;
    const saved = await enqueueMutation({ kind: "add" }, (current) => {
      const trimmed = value.trim();
      const problem = validate(trimmed, current, null);
      if (problem) {
        return { problem };
      }
      return [...current, trimmed];
    });
    if (saved) {
      setAddValue("");
      setFocusRequest({ kind: "add" });
    }
  }

  return (
    <form
      className={`${styles.ruleCard} ${styles.alertSettingsCard}`}
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <h2>Staff alert recipients</h2>
      <p className={styles.hint}>
        Each conversation sends one alert to every address in this list.
        Changes save immediately.
      </p>

      {recipients.length === 0 ? (
        <p className={styles.hint}>
          No recipients yet. Add the first address below and it becomes its
          own box in the list.
        </p>
      ) : (
        <ul className={styles.recipientList}>
          {recipients.map((recipient, index) => {
            const editingThis = editing?.index === index;
            const rowPending =
              (pending?.kind === "edit" || pending?.kind === "delete") &&
              pending.index === index;
            const lastBox = recipients.length === 1;
            return (
              <li key={recipient} className={styles.recipientRow} data-pending={rowPending || undefined}>
                {editingThis ? (
                  <div className={styles.recipientEditArea}>
                    <label
                      className={styles.recipientEditLabel}
                      htmlFor={`recipient-edit-${index}`}
                    >
                      Edit address
                    </label>
                    <input
                      id={`recipient-edit-${index}`}
                      type="text"
                      inputMode="email"
                      autoComplete="off"
                      className={styles.recipientInput}
                      value={editing.value}
                      autoFocus
                      onChange={(event) =>
                        setEditing({ index, value: event.target.value })
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          if (!pending) {
                            void saveEdit();
                          }
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelEdit();
                        }
                      }}
                    />
                    {error?.at === index ? (
                      <p className={styles.recipientError} role="alert">
                        {error.message}
                      </p>
                    ) : null}
                    <div className={styles.recipientControls}>
                      <PendingButton
                        type="button"
                        className={styles.secondaryButton}
                        pending={pending?.kind === "edit" && pending.index === index}
                        pendingLabel="Saving…"
                        onClick={() => {
                          if (!pending) {
                            void saveEdit();
                          }
                        }}
                      >
                        Save
                      </PendingButton>
                      <button
                        type="button"
                        className={styles.ghostButton}
                        disabled={pending?.kind === "edit" && pending.index === index}
                        onClick={cancelEdit}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className={styles.recipientAddress}>{recipient}</span>
                    {error?.at === index ? (
                      <p className={styles.recipientError} role="alert">
                        {error.message}
                      </p>
                    ) : null}
                    <div className={styles.recipientControls}>
                      <button
                        type="button"
                        ref={(element) => {
                          editRefs.current[index] = element;
                        }}
                        className={`${styles.secondaryButton} ${styles.recipientIcon}`}
                        aria-label={`Edit ${recipient}`}
                        onClick={() => beginEdit(index)}
                      >
                        {PENCIL}
                      </button>
                      <PendingButton
                        type="button"
                        className={`${styles.secondaryButton} ${styles.recipientIcon}`}
                        ariaLabel={`Delete ${recipient}`}
                        ariaDescribedBy={lastBox ? "recipient-last-note" : undefined}
                        pending={pending?.kind === "delete" && pending.index === index}
                        pendingLabel="Deleting…"
                        disabled={lastBox}
                        onClick={() => void remove(index)}
                      >
                        {TRASH}
                      </PendingButton>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {recipients.length === 1 ? (
        <p id="recipient-last-note" className={styles.hint}>
          At least one recipient must stay on the list, so the last box's
          Delete is disabled.
        </p>
      ) : null}

      <div className={styles.recipientAdd}>
        <label htmlFor="recipient-add">Add a recipient</label>
        <div className={styles.recipientAddRow}>
          <input
            ref={addInputRef}
            id="recipient-add"
            type="text"
            inputMode="email"
            autoComplete="off"
            placeholder="front-desk@example.edu"
            className={styles.recipientInput}
            value={addValue}
            onChange={(event) => setAddValue(event.target.value)}
          />
          <PendingButton
            type="submit"
            className={styles.secondaryButton}
            ariaLabel="Add recipient"
            pending={pending?.kind === "add"}
            pendingLabel="Adding…"
            disabled={recipients.length >= 10}
          >
            Add
          </PendingButton>
        </div>
        {error?.at === "add" ? (
          <p className={styles.recipientError} role="alert">
            {error.message}
          </p>
        ) : null}
        {recipients.length >= 10 ? (
          <p className={styles.hint}>The list holds at most 10 addresses.</p>
        ) : null}
      </div>

      {status ? (
        <p className={styles.hint} role="status">
          {status}
        </p>
      ) : null}
    </form>
  );
}
