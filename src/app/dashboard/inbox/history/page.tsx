import ConversationDesk from "../conversation-desk";

/** The desk's archive: conversations quiet for a day or closed (ticket 12). */
export default function HistoryPage() {
  return <ConversationDesk selectedId={null} view="history" />;
}
