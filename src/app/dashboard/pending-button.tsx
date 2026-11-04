"use client";

import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import styles from "./dashboard.module.css";

type PendingButtonProps = {
  /** True while this button's action is in flight; drives the verb swap. */
  pending: boolean;
  /** The active-verb label shown while pending ("Saving…", "Taking over…"). */
  pendingLabel: string;
  children: ReactNode;
  className?: string;
  type?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
  disabled?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

/**
 * The shared pending treatment (ticket 42): while the action runs the button
 * swaps to its active verb, announces busy to assistive tech, and carries
 * the shared spinner (animation gated on motion preference — the pending
 * text alone is the reduced-motion feedback). Styling stays with the
 * caller's classes; the pattern is the behavior, not the look.
 *
 * Duplicate submission is blocked in layers: the in-flight latch swallows
 * re-entrant clicks within the handler's own tick, the pending flip disables
 * the button across renders, and the caller's own busy guard remains as the
 * last line — the same layering as the widget's `sendingRef` (ticket 18).
 * The latch clears in a microtask after the handler returns, so a handler
 * that bows out (a cancelled confirm, a validation return) cannot wedge the
 * button shut.
 */
export default function PendingButton({
  pending,
  pendingLabel,
  children,
  className,
  type = "button",
  disabled,
  onClick,
}: PendingButtonProps) {
  const inFlightRef = useRef(false);
  useEffect(() => {
    if (!pending) {
      inFlightRef.current = false;
    }
  }, [pending]);

  return (
    <button
      type={type}
      className={pending ? `${styles.pendingButton}${className ? ` ${className}` : ""}` : className}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      onClick={
        pending
          ? undefined
          : (event) => {
              if (inFlightRef.current) {
                event.preventDefault();
                return;
              }
              inFlightRef.current = true;
              try {
                onClick?.(event);
              } finally {
                queueMicrotask(() => {
                  inFlightRef.current = false;
                });
              }
            }
      }
    >
      {pending ? (
        <>
          <span className={styles.pendingSpinner} aria-hidden="true" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}
