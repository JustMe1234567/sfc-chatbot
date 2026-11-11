import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requireStaff } from "@/api/staff";
import { STAFF_ROLES } from "@/auth/server";
import { isConversationActive } from "@/domain/activity";
import ConversationDesk from "../conversation-desk";
import styles from "../../dashboard.module.css";
import { getChatbotService } from "@/db/service";
import type { Metadata } from "next";

/** Route-specific document title (ticket 29). */
export const metadata: Metadata = { title: "Conversation" };


interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * A conversation selected on the desk. Deep links from alerts keep working
 * by landing on this route, which renders the desk with the conversation
 * open in the main pane (ticket 12). Authorization comes before existence:
 * the visitor-style 404 oracle must not leak conversation ids to signed-out
 * callers. The right tab is whichever one holds the conversation.
 */
export default async function DeskConversationPage({ params }: PageProps) {
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
    notFound();
  }
  return (
    <ConversationDesk
      selectedId={id}
      view={isConversationActive(conversation) ? "active" : "history"}
    />
  );
}
