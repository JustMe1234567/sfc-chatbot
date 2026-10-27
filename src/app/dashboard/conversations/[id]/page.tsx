import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Deep links to a conversation (escalation alert emails, bookmarks) now land
 * on the conversation desk (ticket 12), which shows the transcript and every
 * action in the main pane.
 */
export default async function ConversationRedirect({ params }: PageProps) {
  const { id } = await params;
  redirect(`/dashboard/inbox/${encodeURIComponent(id)}`);
}
