import ConversationDesk from "./conversation-desk";

/** The conversation desk (ticket 12): live Incoming and Active lists. */
export default function InboxPage() {
  return <ConversationDesk selectedId={null} view="active" />;
}
