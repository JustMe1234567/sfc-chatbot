"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { RuleView } from "@/api/staffAnswerRules";
import ConfirmDialog from "../confirm-dialog";
import styles from "../dashboard.module.css";

/**
 * The answer card's lifecycle actions (ticket 58). Beside Edit answer, a
 * three-dot button opens the reference's menu — Duplicate, Publish or
 * Unpublish, Archive, and, behind a divider, the red Delete — on active
 * answers; Archived and Trash views offer Restore (Trash additionally
 * Permanently delete). Each item performs its real mutation, pending and
 * failed actions speak in the footer, repeated clicks cannot issue a second
 * mutation, and permanent deletion goes through the dashboard's shared
 * confirm dialog (ticket 51) naming the answer — cancel leaves it intact.
 * The menu is fully keyboard operable and merely opening it never touches
 * the answer.
 */

type ActionKind =
  | "duplicate"
  | "publish"
  | "unpublish"
  | "archive"
  | "trash"
  | "restore"
  | "purge";

const PENDING_LABELS: Record<ActionKind, string> = {
  duplicate: "Duplicating…",
  publish: "Publishing…",
  unpublish: "Unpublishing…",
  archive: "Archiving…",
  trash: "Moving to Trash…",
  restore: "Restoring…",
  purge: "Deleting…",
};

/** The menu is a real popover of actions: opening it never acts. */
interface MenuItem {
  kind: ActionKind;
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
  dividerBefore?: boolean;
}

function MenuGlyph({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={15}
      height={15}
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

const CopyIcon = (
  <MenuGlyph>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </MenuGlyph>
);
const EyeIcon = (
  <MenuGlyph>
    <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.8" />
  </MenuGlyph>
);
const EyeOffIcon = (
  <MenuGlyph>
    <path d="M2.5 12s3.5-6.5 9.5-6.5c1.6 0 3 .4 4.3 1M21.5 12s-3.5 6.5-9.5 6.5c-1.6 0-3-.4-4.3-1" />
    <path d="m4 20 16-16" />
  </MenuGlyph>
);
const ArchiveIcon = (
  <MenuGlyph>
    <rect x="3" y="4" width="18" height="5" rx="1" />
    <path d="M5 9v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" />
    <path d="M10 13h4" />
  </MenuGlyph>
);
const TrashIcon = (
  <MenuGlyph>
    <path d="M4 6.5h16" />
    <path d="M9 6.5V4.8A1.3 1.3 0 0 1 10.3 3.5h3.4A1.3 1.3 0 0 1 15 4.8v1.7" />
    <path d="M6 6.5 6.8 19a1.5 1.5 0 0 0 1.5 1.4h7.4A1.5 1.5 0 0 0 17.2 19L18 6.5" />
    <path d="M10 10.5v6M14 10.5v6" />
  </MenuGlyph>
);
const UndoIcon = (
  <MenuGlyph>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h9.5A6.5 6.5 0 0 1 20 15.5v1" />
  </MenuGlyph>
);

/**
 * The menu's items for a rule in its current view (ticket 58): active
 * answers carry the reference's Duplicate / Publish-or-Unpublish / Archive
 * / Delete order with the divider before red Delete; draft cards show
 * Publish in place of Unpublish; Archived offers Restore; Trash offers
 * Restore and Permanently delete.
 */
export function menuItemsFor(rule: RuleView): MenuItem[] {
  if (rule.status === "archived") {
    return [{ kind: "restore", label: "Restore", icon: UndoIcon }];
  }
  if (rule.status === "trashed") {
    return [
      { kind: "restore", label: "Restore", icon: UndoIcon },
      { kind: "purge", label: "Permanently delete", icon: TrashIcon, danger: true, dividerBefore: true },
    ];
  }
  return [
    { kind: "duplicate", label: "Duplicate", icon: CopyIcon },
    rule.status === "published"
      ? { kind: "unpublish", label: "Unpublish", icon: EyeOffIcon }
      : { kind: "publish", label: "Publish", icon: EyeIcon },
    { kind: "archive", label: "Archive", icon: ArchiveIcon },
    { kind: "trash", label: "Delete", icon: TrashIcon, danger: true, dividerBefore: true },
  ];
}

export default function AnswerActions({
  rule,
  onUpdated,
  onCreated,
  onRemoved,
}: {
  rule: RuleView;
  onUpdated: (rule: RuleView) => void;
  onCreated: (rule: RuleView) => void;
  onRemoved: (id: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingPurge, setConfirmingPurge] = useState(false);
  const [pending, setPending] = useState<ActionKind | null>(null);
  const [error, setError] = useState<ActionKind | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  function focusMenuItem(offset: 1 | -1 | 0) {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [],
    );
    if (items.length === 0) {
      return;
    }
    const currentIndex = items.findIndex((item) => item === document.activeElement);
    const nextIndex =
      offset === 0
        ? 0
        : (currentIndex + offset + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  function onMenuKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusMenuItem(document.activeElement === menuButtonRef.current ? 0 : 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusMenuItem(-1);
    } else if (event.key === "Tab") {
      setMenuOpen(false);
    }
  }

  async function runAction(kind: ActionKind) {
    if (pending !== null) {
      // One mutation in flight per card: repeat clicks are ignored.
      return;
    }
    if (kind === "purge") {
      // The irreversible step goes through the shared confirm dialog (the
      // repo never uses the browser's own popup — ticket 51), naming the
      // answer; cancel leaves it intact.
      setMenuOpen(false);
      setError(null);
      setConfirmingPurge(true);
      return;
    }
    await performAction(kind);
  }

  async function performAction(kind: ActionKind) {
    if (pending !== null) {
      return;
    }
    setMenuOpen(false);
    setPending(kind);
    setError(null);
    try {
      const response = await fetch(`/api/staff/answer-rules/${rule.id}/${kind}`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(String(response.status));
      }
      const updated = (await response.json()) as RuleView;
      if (kind === "duplicate") {
        onCreated(updated);
      } else if (kind === "purge") {
        onRemoved(rule.id);
        setConfirmingPurge(false);
      } else {
        onUpdated(updated);
      }
    } catch {
      setError(kind);
    } finally {
      setPending(null);
    }
  }

  const published = rule.status === "published";
  const items = menuItemsFor(rule);
  const retired = rule.status === "archived" || rule.status === "trashed";

  return (
    <div className={styles.answersMenuWrap} ref={wrapRef}>
      {!retired ? (
        <Link className={styles.answersEdit} href={`/dashboard/answers/${rule.id}`}>
          <svg
            viewBox="0 0 24 24"
            width={14}
            height={14}
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m14.5 6.5 3 3" />
            <path d="M4 20l1-4L16.5 4.5a2.12 2.12 0 0 1 3 3L8 19l-4 1Z" />
          </svg>
          Edit answer
        </Link>
      ) : null}
      <div
        className={styles.answersMenuWrap}
        onKeyDown={onMenuKeyDown}
      >
        <button
          ref={menuButtonRef}
          type="button"
          className={styles.answersMenuButton}
          aria-label={`More actions for ${rule.topic}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={`answer-menu-${rule.id}`}
          disabled={pending !== null}
          onClick={() => setMenuOpen((value) => !value)}
        >
          ···
        </button>
        {menuOpen ? (
          <ul
            ref={menuRef}
            id={`answer-menu-${rule.id}`}
            role="menu"
            aria-label={`Actions for ${rule.topic}`}
            className={styles.answersMenu}
          >
            {items.map((item) => (
              <li key={item.kind} role="none">
                {item.dividerBefore ? <hr className={styles.answersMenuDivider} /> : null}
                <button
                  type="button"
                  role="menuitem"
                  className={styles.answersMenuItem}
                  data-danger={item.danger || undefined}
                  disabled={pending !== null}
                  onClick={() => runAction(item.kind)}
                >
                  {item.icon}
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {pending !== null && !confirmingPurge ? (
        <p className={styles.answersActionNote} role="status">
          {PENDING_LABELS[pending]}
        </p>
      ) : null}
      {pending === null && error !== null && !confirmingPurge ? (
        <p className={styles.answersActionNote} role="status" data-error="">
          {PENDING_LABELS[error].replace("…", " failed. Try again.")}
        </p>
      ) : null}
      {confirmingPurge ? (
        <ConfirmDialog
          title="Permanently delete this answer?"
          confirmLabel="Permanently delete"
          pendingLabel="Deleting…"
          pending={pending === "purge"}
          error={error === "purge" ? `Couldn't delete "${rule.topic}". Try again.` : ""}
          onConfirm={() => void performAction("purge")}
          onCancel={() => {
            setConfirmingPurge(false);
            setError(null);
          }}
        >
          <p>
            &ldquo;{rule.topic}&rdquo; leaves Trash for good and can never be
            restored. Its transcript history and audit record are kept. This
            cannot be undone.
          </p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
