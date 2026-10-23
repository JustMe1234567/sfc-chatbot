import { headers } from "next/headers";
import Link from "next/link";
import { requireStaff } from "@/api/staff";
import { STAFF_ROLES } from "@/auth/server";
import { roleLabel } from "@/domain/inbox";
import { staffName } from "@/api/staffConversations";
import { auditWithNames } from "@/api/audit";
import { listStaffMembers } from "@/api/staffMembers";
import { getChatbotService } from "@/db/service";
import type { AuditView } from "@/api/audit";
import AutoRefresh from "./auto-refresh";
import { ClaimButton, ReleaseAndTransfer, ReplyAndClose } from "./conversation-actions";
import styles from "../../dashboard.module.css";

interface PageProps {
  params: Promise<{ id: string }>;
}

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

export default async function ConversationPage({ params }: PageProps) {
  const staffHeaders = await headers();
  const guard = await requireStaff(staffHeaders, { roles: STAFF_ROLES });
  if ("response" in guard) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>This page requires an authorized staff session.</p>
      </main>
    );
  }

  const { id } = await params;
  const { store, db } = await getChatbotService();
  const conversation = await store.getConversation(id);
  if (!conversation) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>Conversation not found.</p>
      </main>
    );
  }
  const messages = await store.listMessages(conversation.id);
  const auditEntries = auditWithNames(db, await store.listConversationAudit(conversation.id));
  const claimerName = conversation.claimedBy
    ? (staffName(db, conversation.claimedBy) ?? "another staff member")
    : null;
  const claimedByMe = conversation.claimedBy === guard.staff.userId;
  const mayReassign =
    conversation.state === "claimed" && (claimedByMe || guard.staff.role === "owner");
  // Transfer targets mirror the API's eligibility exactly: active, verified,
  // second-factor-enrolled inbox members who don't already own it.
  const transferTargets = listStaffMembers(db)
    .filter(
      (member) =>
        member.id !== conversation.claimedBy &&
        (member.role === "owner" || member.role === "staff") &&
        !member.banned &&
        member.emailVerified &&
        member.twoFactorEnabled,
    )
    .map((member) => ({ id: member.id, name: member.name }));

  return (
    <main className={styles.shell}>
      <AutoRefresh />
      <header className={styles.shellHeader}>
        <h1>Conversation</h1>
        <Link href="/dashboard/inbox">Back to inbox</Link>
      </header>
      <p className={styles.hint}>
        {conversation.state === "awaiting_staff" && "Waiting for a staff member to claim this conversation."}
        {conversation.state === "claimed" &&
          (claimedByMe
            ? "You are helping in this conversation."
            : `${claimerName} is helping in this conversation.`)}
        {conversation.state === "closed" && "This conversation is closed."}
      </p>
      {conversation.state === "awaiting_staff" && <ClaimButton conversationId={id} />}
      {mayReassign && <ReleaseAndTransfer conversationId={id} targets={transferTargets} />}
      {claimedByMe && conversation.state === "claimed" && (
        <ReplyAndClose conversationId={id} />
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
        <section aria-label="Audit trail" className={styles.inbox}>
          <h2>Activity</h2>
          {auditEntries.map((entry) => (
            <div key={entry.id} className={styles.conversationCard}>
              <div className={styles.meta}>
                {new Date(entry.createdAt).toLocaleString("en-GB")}
              </div>
              <div className={styles.preview}>
                {entry.actorName ?? "a former staff member"} {ACTION_LABELS[entry.action]}
                {entry.detail ? ` → ${entry.detail}` : ""}
              </div>
            </div>
          ))}
        </section>
      ) : null}
    </main>
  );
}
