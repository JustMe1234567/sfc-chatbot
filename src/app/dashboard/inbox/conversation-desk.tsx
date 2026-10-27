import { headers } from "next/headers";
import Link from "next/link";
import { requireStaff } from "@/api/staff";
import { STAFF_ROLES } from "@/auth/server";
import { roleLabel, summarizeConversationDesk, summarizeConversationHistory, type DeskItem } from "@/domain/inbox";
import { isConversationActive } from "@/domain/activity";
import { staffName } from "@/api/staffConversations";
import { auditWithNames, type AuditView } from "@/api/audit";
import { listStaffMembers } from "@/api/staffMembers";
import { getChatbotService } from "@/db/service";
import AutoRefresh from "../conversations/[id]/auto-refresh";
import { ClaimButton, ReleaseAndTransfer, ReplyAndClose } from "../conversations/[id]/conversation-actions";
import SignOutButton from "./sign-out-button";
import styles from "../dashboard.module.css";

const ACTION_LABELS: Record<AuditView["action"], string> = {
  conversation_claimed: "claimed this conversation",
  conversation_released: "released this conversation to the inbox",
  conversation_transferred: "transferred this conversation",
  conversation_replied: "replied to the visitor",
  rule_created: "created an answer rule",
  rule_revised: "revised an answer rule",
  rule_published: "published an answer rule",
  rule_unpublished: "unpublished an answer rule",
  staff_invited: "invited a staff member",
  staff_disabled: "disabled a staff account",
};

export interface DeskProps {
  /** The conversation shown in the main pane, if any. */
  selectedId: string | null;
  /** Which list the left side shows: the live desk or the archive. */
  view: "active" | "history";
}

const STATE_LABELS: Record<string, string> = {
  bot_active: "bot",
  awaiting_staff: "waiting",
  claimed: "claimed",
  closed: "closed",
};

function DeskEntry({ item, selected }: { item: DeskItem; selected: boolean }) {
  const preview = item.lastMessage
    ? `${roleLabel(item.lastMessage.role)}: ${item.lastMessage.text.slice(0, 120)}`
    : "No messages";
  return (
    <Link
      href={`/dashboard/inbox/${item.id}`}
      className={styles.deskItem}
      data-selected={selected || undefined}
      aria-current={selected ? "true" : undefined}
    >
      <span className={styles.deskItemTop}>
        <span className={styles.deskItemState}>{STATE_LABELS[item.state] ?? item.state}</span>
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
    </Link>
  );
}

/**
 * The staff conversation desk (ticket 12): a compact conversation list on the
 * left, the selected transcript and reply controls on the right. Incoming
 * holds the waiting escalations; Active holds bot-active and claimed chats;
 * History is the archive of conversations quiet for a day or closed.
 */
export default async function ConversationDesk({ selectedId, view }: DeskProps) {
  const staffHeaders = await headers();
  const guard = await requireStaff(staffHeaders, { roles: STAFF_ROLES });
  if ("response" in guard) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>This page requires an authorized staff session.</p>
      </main>
    );
  }

  const { store, db } = await getChatbotService();
  // History view skips the live-desk scan entirely: the archive and the
  // active lists are disjoint, and a day-old conversation never carries the
  // attention alert.
  const desk = view === "active" ? await summarizeConversationDesk(store) : null;
  const history = view === "history" ? await summarizeConversationHistory(store) : [];

  const selected = selectedId ? await store.getConversation(selectedId) : null;
  const selectedActive = selected ? isConversationActive(selected) : false;
  // Opening the transcript is viewing it: the attention alert clears, so the
  // next visitor message can raise it again. The desk polls every few
  // seconds, so a staff member watching the pane stays "viewing".
  if (selected) {
    await store.clearConversationAttention(selected.id);
  }
  const messages = selected ? await store.listMessages(selected.id) : [];
  const auditEntries = selected ? auditWithNames(db, await store.listConversationAudit(selected.id)) : [];
  const claimerName = selected?.claimedBy
    ? (staffName(db, selected.claimedBy) ?? "another staff member")
    : null;
  const claimedByMe = selected?.claimedBy === guard.staff.userId;
  const mayReassign =
    selected?.state === "claimed" && (claimedByMe || guard.staff.role === "owner");
  // Transfer targets mirror the API's eligibility exactly: active, verified,
  // second-factor-enrolled inbox members who don't already own it.
  const transferTargets = selected
    ? listStaffMembers(db)
        .filter(
          (member) =>
            member.id !== selected.claimedBy &&
            (member.role === "owner" || member.role === "staff") &&
            !member.banned &&
            member.emailVerified &&
            member.twoFactorEnabled,
        )
        .map((member) => ({ id: member.id, name: member.name }))
    : [];

  return (
    <main className={styles.shell}>
      <AutoRefresh />
      <header className={styles.shellHeader}>
        <h1>Conversations</h1>
        <div className={styles.whoami}>
          {guard.staff.role === "owner" ? (
            <>
              <Link href="/dashboard/answers">Answers</Link>
              <Link href="/dashboard/staff">Staff</Link>
            </>
          ) : null}
          <Link href="/dashboard/notifications">Email alerts</Link>
          <span>
            {guard.staff.name} · {guard.staff.role}
          </span>
          <SignOutButton />
        </div>
      </header>
      <div className={styles.desk}>
        <nav className={styles.deskList} aria-label="Conversation list">
          <div className={styles.deskTabs}>
            <Link href="/dashboard/inbox" aria-current={view === "active" ? "page" : undefined}>
              Conversations
              {desk && desk.attentionCount > 0 ? ` (${desk.attentionCount} new)` : ""}
            </Link>
            <Link
              href="/dashboard/inbox?view=history"
              aria-current={view === "history" ? "page" : undefined}
            >
              History
            </Link>
          </div>
          {desk ? (
            <>
              <h2>Incoming</h2>
              {desk.incoming.length === 0 ? (
                <p className={styles.deskEmpty}>Nothing is waiting for staff.</p>
              ) : (
                desk.incoming.map((item) => (
                  <DeskEntry key={item.id} item={item} selected={item.id === selectedId} />
                ))
              )}
              <h2>Active</h2>
              {desk.active.length === 0 ? (
                <p className={styles.deskEmpty}>No live conversations right now.</p>
              ) : (
                desk.active.map((item) => (
                  <DeskEntry key={item.id} item={item} selected={item.id === selectedId} />
                ))
              )}
            </>
          ) : (
            <>
              <h2>History</h2>
              {history.length === 0 ? (
                <p className={styles.deskEmpty}>No past conversations yet.</p>
              ) : (
                history.map((item) => (
                  <DeskEntry key={item.id} item={item} selected={item.id === selectedId} />
                ))
              )}
            </>
          )}
        </nav>
        <section className={styles.deskPane} aria-label="Selected conversation">
          {selected ? (
            <>
              <Link
                className={styles.deskBack}
                href={view === "history" ? "/dashboard/inbox?view=history" : "/dashboard/inbox"}
              >
                ← All conversations
              </Link>
              <p className={styles.hint}>
                {selected.state === "awaiting_staff" && selectedActive &&
                  "Waiting for a staff member to claim this conversation."}
                {selected.state === "claimed" && selectedActive &&
                  (claimedByMe
                    ? "You are helping in this conversation."
                    : `${claimerName} is helping in this conversation.`)}
                {selected.state === "closed" && "This conversation is closed."}
                {!selectedActive && selected.state !== "closed" &&
                  "This conversation has gone quiet and moved to History. The visitor's next question starts a fresh chat."}
              </p>
              {selected.state === "awaiting_staff" && selectedActive && (
                <ClaimButton conversationId={selected.id} />
              )}
              {mayReassign && selectedActive && (
                <ReleaseAndTransfer conversationId={selected.id} targets={transferTargets} />
              )}
              {claimedByMe && selected.state === "claimed" && selectedActive && (
                <ReplyAndClose conversationId={selected.id} />
              )}
              {claimedByMe && selected.state === "claimed" && !selectedActive && (
                <p className={styles.hint}>
                  Replying is paused until a reopening action exists; the transcript is kept.
                </p>
              )}
              <div className={styles.transcript}>
                {messages.map((message) => (
                  <div key={message.id} className={styles.bubble}>
                    <div className={styles.role}>
                      {roleLabel(message.role)} ·{" "}
                      {new Date(message.createdAt).toLocaleString("en-GB")}
                    </div>
                    {message.text}
                  </div>
                ))}
              </div>
              {auditEntries.length > 0 ? (
                <section aria-label="Audit trail" className={styles.deskActivity}>
                  <h2>Activity</h2>
                  {auditEntries.map((entry) => (
                    <div key={entry.id} className={styles.deskAuditRow}>
                      <span className={styles.deskAuditMeta}>
                        {new Date(entry.createdAt).toLocaleString("en-GB")}
                      </span>
                      <span>
                        {entry.actorName ?? "a former staff member"} {ACTION_LABELS[entry.action]}
                        {entry.detail ? ` → ${entry.detail}` : ""}
                      </span>
                    </div>
                  ))}
                </section>
              ) : null}
            </>
          ) : (
            <p className={styles.empty}>Select a conversation from the list.</p>
          )}
        </section>
      </div>
    </main>
  );
}
