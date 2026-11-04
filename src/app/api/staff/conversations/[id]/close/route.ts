import { NextResponse } from "next/server";
import { sameOriginGuard } from "@/api/staff";
import { claimConflictResponse, loadStaffConversation } from "@/api/staffConversations";
import { CLOSING_NOTICE } from "@/domain/conversations";
import { getChatbotService } from "@/db/service";
import type { Message } from "@/domain/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Closes a resolved conversation. A later visitor message is refused and the
 * visitor's next question starts a fresh conversation.
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
  const { conversation, staff, claimerName } = loaded;

  if (conversation.state === "closed") {
    return NextResponse.json({ conversation });
  }
  if (conversation.state !== "claimed" || conversation.claimedBy !== staff.userId) {
    if (conversation.state === "claimed") {
      return claimConflictResponse(claimerName);
    }
    // Closing requires a prior claim so every closure is attributable to the
    // staff member who handled the conversation.
    return NextResponse.json(
      {
        error: {
          code: "invalid_state",
          message: "Take over the conversation before closing it.",
        },
      },
      { status: 409 },
    );
  }

  const { store } = await getChatbotService();
  await store.closeConversation(id);
  const notice: Message = {
    id: crypto.randomUUID(),
    conversationId: id,
    role: "bot",
    text: CLOSING_NOTICE,
    createdAt: new Date().toISOString(),
  };
  await store.appendMessage(notice);
  const closed = await store.getConversation(id);
  return NextResponse.json({ conversation: closed });
}
