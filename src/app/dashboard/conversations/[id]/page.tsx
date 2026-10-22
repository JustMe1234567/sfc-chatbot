import { headers } from "next/headers";
import Link from "next/link";
import { requireStaff } from "@/api/staff";
import { STAFF_ROLES } from "@/auth/server";
import { roleLabel } from "@/domain/inbox";
import { getChatbotService } from "@/db/service";
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
  const { store } = await getChatbotService();
  const conversation = await store.getConversation(id);
  if (!conversation) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>Conversation not found.</p>
      </main>
    );
  }
  const messages = await store.listMessages(conversation.id);

  return (
    <main className={styles.shell}>
      <header className={styles.shellHeader}>
        <h1>Conversation</h1>
        <Link href="/dashboard/inbox">Back to inbox</Link>
      </header>
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
