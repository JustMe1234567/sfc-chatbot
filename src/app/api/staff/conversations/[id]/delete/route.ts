import { NextResponse } from "next/server";
import { sameOriginGuard } from "@/api/staff";
import { loadStaffConversation } from "@/api/staffConversations";
import { getChatbotService } from "@/db/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Hard-deletes one closed conversation from the History tab (ticket 51) —
 * the manual equivalent of the retention sweep's purge. The same
 * transactional primitive removes the transcript, visitor sessions, return
 * links, and notification rows while detaching audit rows, and refuses
 * anything not closed, so live conversations can never be deleted through
 * this route.
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
  if (loaded.conversation.state !== "closed") {
    return NextResponse.json(
      {
        error: {
          code: "invalid_state",
          message: "Only closed conversations can be deleted. Close it first.",
        },
      },
      { status: 409 },
    );
  }

  const { store } = await getChatbotService();
  const removed = await store.purgeClosedConversation(id);
  if (!removed) {
    // The state moved between the load and the purge: someone deleted it
    // concurrently (gone → 404) or it reopened (no longer eligible → 409).
    const stillThere = await store.getConversation(id);
    if (!stillThere) {
      return NextResponse.json(
        { error: { code: "conversation_not_found", message: "Conversation not found." } },
        { status: 404 },
      );
    }
    return NextResponse.json(
      {
        error: {
          code: "invalid_state",
          message: "This conversation can no longer be deleted.",
        },
      },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, removed: 1 });
}
