"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import { DESK_STATE_LABELS, roleLabel, type DeskItem } from "@/domain/inbox";
import styles from "../dashboard.module.css";

/**
 * One conversation row on the desk (ticket 12), with the reopened ticket-42
 * row-level pending state: while this row's navigation is in flight the row
 * goes busy and its fixed-size "Loading…" hint fades in, so a click always
 * reads as registered and the desk itself never blanks mid-navigation — the
 * dashboard deliberately ships no route-level loading shell above the desk.
 * Quick successive clicks supersede cleanly: the framework shows only the
 * last-clicked link's pending state.
 */
export default function DeskEntry({ item, selected }: { item: DeskItem; selected: boolean }) {
  // The CSS line-clamp trims the preview with an ellipsis; no JS slicing.
  const preview = item.lastMessage
    ? `${roleLabel(item.lastMessage.role)}: ${item.lastMessage.text}`
    : "No messages";
  return (
    <Link
      href={`/dashboard/inbox/${item.id}`}
      className={styles.deskItem}
      data-selected={selected || undefined}
      aria-current={selected ? "true" : undefined}
    >
      <RowBody item={item} preview={preview} />
    </Link>
  );
}

/** Lives inside the Link so useLinkStatus can report this row's navigation. */
function RowBody({ item, preview }: { item: DeskItem; preview: string }) {
  const { pending } = useLinkStatus();
  return (
    <span aria-busy={pending || undefined} className={styles.deskItemBody}>
      <span className={styles.deskItemTop}>
        <span className={styles.deskItemState}>
          {DESK_STATE_LABELS[item.state] ?? item.state}
        </span>
        <time dateTime={item.lastActivityAt}>
          {new Date(item.lastActivityAt).toLocaleString("en-GB", {
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
      </span>
      <span className={styles.deskItemPreview}>{preview}</span>
      {item.attention ? <span className={styles.attentionBadge}>New message</span> : null}
      <span className={styles.rowPending} aria-hidden="true">
        Loading…
      </span>
    </span>
  );
}
