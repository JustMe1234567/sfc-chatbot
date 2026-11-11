import ConversationDesk from "./conversation-desk";
import type { Metadata } from "next";

/** Route-specific document title (ticket 29). */
export const metadata: Metadata = { title: "Inbox" };

/** The conversation desk (ticket 12): live Incoming and Active lists. */
export default function InboxPage() {
  return <ConversationDesk selectedId={null} view="active" />;
}
