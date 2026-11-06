import { NextResponse } from "next/server";
import { sameOriginGuard } from "@/api/staff";
import { loadStaffConversation } from "@/api/staffConversations";
import { getChatbotService } from "@/db/service";
import { historyQuietBefore, isConversationActive } from "@/domain/activity";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function liveConflict(message: string) {
  return NextResponse.json({ error: { code: "conversation_live", message } }, { status: 409 });
}

/**
 * Hard-deletes one History conversation (ticket 51, widened by ticket 62 to
 * every History row: closed, or quiet past the inactivity window in any
 * stored state) — the manual equivalent of the retention sweep's purge. The
 * same transactional primitive removes the transcript, visitor sessions,
 * return links, and notification rows while detaching audit rows, and it
 * rechecks History membership inside its transaction, so a conversation
 * that is live — or turned live after the list rendered — is refused with
 * every record intact.
 */
export async function POST(request: Request, context: RouteContext) {
  const blocked = sameOriginGuard(request);
  if (blocked) {
    return blocked;
  }
  const { id } = await context.params;
  const loaded = await loadStaffConversation(request.headers, id);
  if ("response" in loaded) {
    return loaded.response;
  }
  const now = new Date();
  if (isConversationActive(loaded.conversation, now)) {
    return liveConflict(
      "This conversation is still live on the Conversations tab. Only History conversations can be deleted.",
    );
  }

  const { store } = await getChatbotService();
  const removed = await store.purgeHistoryConversation(id, historyQuietBefore(now));
  if (!removed) {
    // Membership moved between the load and the purge: someone deleted it
    // concurrently (gone → 404) or it turned live again (→ 409).
    const stillThere = await store.getConversation(id);
    if (!stillThere) {
      return NextResponse.json(
        { error: { code: "conversation_not_found", message: "Conversation not found." } },
        { status: 404 },
      );
    }
    return liveConflict(
      "This conversation became live again and was kept. Only History conversations can be deleted.",
    );
  }
  return NextResponse.json({ ok: true, removed: 1 });
}
