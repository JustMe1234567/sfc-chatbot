import { headers } from "next/headers";
import Link from "next/link";
import { requireStaff } from "@/api/staff";
import { STAFF_ROLES } from "@/auth/server";
import { roleLabel } from "@/domain/inbox";
import { staffName } from "@/api/staffConversations";
import { getChatbotService } from "@/db/service";
import AutoRefresh from "./auto-refresh";
import { ClaimButton, ReplyAndClose } from "./conversation-actions";
import styles from "../../dashboard.module.css";

interface PageProps {
  params: Promise<{ id: string }>;
}

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
  const claimerName = conversation.claimedBy
    ? (staffName(db, conversation.claimedBy) ?? "another staff member")
    : null;
  const claimedByMe = conversation.claimedBy === guard.staff.userId;

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
    </main>
  );
}
