"use client";

import { useEffect, useRef, type ReactNode } from "react";
import PendingButton from "./pending-button";
import styles from "./dashboard.module.css";

/**
 * The dashboard's shared confirmation modal (ticket 51): an in-page dialog
 * for irreversible actions, never the browser's own confirm popup. Focus
 * moves into the dialog on open (the safe Cancel control), Tab stays among
 * the dialog's controls, and Escape or a backdrop click hand control back
 * through onCancel; the trigger returns focus to itself on close. While the
 * confirmed action is in flight, the confirm button carries the ticket-42
 * pending treatment and both controls disable.
 */
export default function ConfirmDialog({
  title,
  children,
  confirmLabel,
  pendingLabel,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  pending: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useRef(`confirm-title-${crypto.randomUUID()}`).current;

  useEffect(() => {
    // The safe control takes focus first, so an unthinking Enter or Space
    // dismisses rather than destroys. Runs once per open — not on pending
    // flips, which must not yank focus off the button being watched.
    cancelRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        onCancel();
      }
      if (event.key === "Tab" && cardRef.current) {
        // Keep keyboard focus cycling among the dialog's own controls.
        const focusable = cardRef.current.querySelectorAll<HTMLElement>("button:not([disabled])");
        const first = focusable.item(0);
        const last = focusable.item(focusable.length - 1);
        if (!first || !last) {
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pending, onCancel]);

  return (
    <div
      className={styles.modalOverlay}
      onMouseDown={(event) => {
        // Only a click on the backdrop itself dismisses — a click inside
        // the card bubbles a target that is not the overlay. The default
        // mousedown (blur to body) is prevented so the focus the trigger
        // restores on close is not immediately stolen.
        if (event.target === event.currentTarget && !pending) {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <div ref={cardRef} className={styles.modalCard} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{title}</h2>
        {children}
        {error ? (
          <p className={styles.modalError} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.modalActions}>
          <button
            ref={cancelRef}
            type="button"
            className={styles.secondaryButton}
            disabled={pending}
            onClick={onCancel}
          >
            Cancel
          </button>
          <PendingButton
            className={styles.destructiveButton}
            pending={pending}
            pendingLabel={pendingLabel}
            disabled={pending}
            onClick={onConfirm}
          >
            {confirmLabel}
          </PendingButton>
        </div>
      </div>
    </div>
  );
}
