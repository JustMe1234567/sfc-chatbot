"use client";

import { useEffect, useRef, useState } from "react";
import PasswordSettings from "./settings/password-settings";
import styles from "./dashboard.module.css";

/**
 * The self-service password change, offered from the dashboard chrome
 * (ticket 102 decision 2): Settings became an Admin area, but every member —
 * Admin and Admissions Advisor alike — still changes their own password, so
 * the trigger sits in the sidebar's identity block where every page renders
 * it. The dialog wraps the unchanged PasswordSettings form (the change goes
 * through the auth endpoint and revokes no sessions, ADR-0006). Like the
 * expanded-rail-only revoke button, the trigger has no icon form and hides
 * in the compact rail.
 */
export default function PasswordDialog() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.secondaryButton} ${styles.passwordTrigger}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        Change password
      </button>
      {open ? (
        <div
          className={styles.modalOverlay}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              event.preventDefault();
              close();
            }
          }}
        >
          <div className={styles.modalCard} role="dialog" aria-modal="true" aria-label="Change password">
            <PasswordSettings />
            <div className={styles.modalActions}>
              <button type="button" className={styles.secondaryButton} onClick={close}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
