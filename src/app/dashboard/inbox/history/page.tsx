import ConversationDesk from "../conversation-desk";
import type { Metadata } from "next";

/** Route-specific document title (ticket 29). */
export const metadata: Metadata = { title: "History" };


/** The desk's archive: conversations quiet for a day or closed (ticket 12). */
export default function HistoryPage() {
  return <ConversationDesk selectedId={null} view="history" />;
}
