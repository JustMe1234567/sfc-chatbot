import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
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
        <p className={styles.empty}>This page requires an authorized session.</p>
      </main>
    );
  }

  const { id } = await params;
  const { store } = await getChatbotService();
  const conversation = await store.getConversation(id);
  if (!conversation) {
    notFound();
  }
  // Empty sessions are hidden from the live lists (ticket 73): a direct
  // link to a clear-created fresh successor reads better as the cleared
  // conversation it replaced — the predecessor is closed, so the redirect
  // lands on History with its retained transcript. Empty sessions without
  // a predecessor keep their current direct-route behavior.
  const visitorAuthored = (await store.listMessages(id)).some(
    (message) => message.role === "visitor",
  );
  if (!visitorAuthored) {
    const predecessorId = await store.findPredecessorId(id);
    if (predecessorId) {
      redirect(`/dashboard/inbox/${predecessorId}`);
    }
  }
  return (
    <ConversationDesk
      selectedId={id}
      view={isConversationActive(conversation) ? "active" : "history"}
    />
  );
}
