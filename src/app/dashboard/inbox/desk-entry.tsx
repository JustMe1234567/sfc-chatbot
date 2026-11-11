"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import {
  DESK_STATE_LABELS,
  DESK_STATUS_LABELS,
  deskLabel,
  deskStatus,
  roleLabel,
  type DeskItem,
  type DeskStatus,
} from "@/domain/inbox";
import { STATUS_DOTS } from "./status-classes";
import { DeleteConversationButton } from "./history-actions";
import styles from "../dashboard.module.css";

/**
 * One conversation row on the desk (ticket 12), with the reopened ticket-42
 * row-level pending state: while this row's navigation is in flight the row
 * goes busy and its fixed-size "Loading…" hint fades in, so a click always
 * reads as registered and the desk itself never blanks mid-navigation — the
 * dashboard deliberately ships no route-level loading shell above the desk.
 * Quick successive clicks supersede cleanly: the framework shows only the
 * last-clicked link's pending state.
 *
 * Ticket 44 adds the shared status treatment for live rows: a tier-colored
 * left border and a status dot with an accessible name, and the two
 * attention-worthy tiers also say it in visible text. Color never works
 * alone. History rows are the archive, not live work: they keep their state
 * text and carry no status treatment at all.
 *
 * Ticket 51 adds a Delete control for History rows (every History row since
 * ticket 62 — closed or quiet in any state; live rows never). The row is a
 * wrapper with the Link and the control as siblings — a button nested in an
 * anchor is invalid HTML and would hijack navigation — while the link-status
 * consumer stays inside the Link so the pending hint keeps working.
 */
export default function DeskEntry({ item, selected }: { item: DeskItem; selected: boolean }) {
  // The CSS line-clamp trims the preview with an ellipsis; no JS slicing.
  const preview = item.lastMessage
    ? `${roleLabel(item.lastMessage.role)}: ${item.lastMessage.text}`
    : "No messages";
  const status: DeskStatus | null = item.active ? deskStatus(item) : null;
  const deletable = !item.active;
  return (
    <span className={styles.deskItemWrap}>
      <Link
        href={`/dashboard/inbox/${item.id}`}
        scroll={false}
        className={styles.deskItem}
        data-selected={selected || undefined}
        data-status={status ?? undefined}
        aria-current={selected ? "true" : undefined}
      >
        <RowBody item={item} status={status} preview={preview} />
      </Link>
      {deletable ? (
        <DeleteConversationButton
          conversationId={item.id}
          selected={selected}
          // Identifies the conversation by state + the row's own displayed
          // time — never by transcript text (ticket 51).
          description={`${DESK_STATE_LABELS[item.state] ?? item.state} · ${new Date(item.lastActivityAt).toLocaleString("en-GB", {
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}`}
        />
      ) : null}
    </span>
  );
}

/** Lives inside the Link so useLinkStatus can report this row's navigation. */
function RowBody({
  item,
  status,
  preview,
}: {
  item: DeskItem;
  status: DeskStatus | null;
  preview: string;
}) {
  const { pending } = useLinkStatus();
  return (
    <span aria-busy={pending || undefined} className={styles.deskItemBody}>
      <span className={styles.deskItemTop}>
        <span className={styles.deskItemState}>
          {status ? (
            <span
              className={`${styles.statusDot} ${STATUS_DOTS[status]}`}
              role="img"
              aria-label={DESK_STATUS_LABELS[status]}
            />
          ) : null}
          {deskLabel(item)}
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
      {status === "needs_human" ? (
        <span className={styles.needsHumanBadge}>Needs human</span>
      ) : null}
      {status === "attention" ? <span className={styles.attentionBadge}>New message</span> : null}
      {/* The persistent Contact Me (ticket 69): survives transcript viewing,
          and renders alongside a transient New message when both stand. */}
      {item.contactRequest ? <span className={styles.attentionBadge}>Contact Me</span> : null}
      <span className={styles.rowPending} aria-hidden="true">
        Loading…
      </span>
    </span>
  );
}
