import { NextResponse } from "next/server";
import { sameOriginGuard } from "@/api/staff";
import { audit } from "@/api/audit";
import {
  claimConflictResponse,
  conversationInactiveResponse,
  loadStaffConversation,
  staffName,
} from "@/api/staffConversations";
import { isConversationActive } from "@/domain/activity";
import { getChatbotService } from "@/db/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Human takeover. The store's conditional UPDATE makes the claim atomic:
 * exactly one concurrent request becomes the owner, and any loser gets the
 * current assignment instead of an error to guess at.
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
  const { conversation, claimerName } = loaded;

  if (conversation.state === "claimed") {
    return claimConflictResponse(claimerName);
  }
  if (conversation.state !== "awaiting_staff") {
    return NextResponse.json(
      { error: { code: "invalid_state", message: "This conversation is not waiting for an advisor." } },
      { status: 409 },
    );
  }
  // A conversation quiet for a day has left the desk's Incoming list; it is
  // history, not claimable work (ticket 12). No reopening action exists yet.
  if (!isConversationActive(conversation)) {
    return conversationInactiveResponse();
  }

  const service = await getChatbotService();
  const claimed = await service.store.claimConversation(id, loaded.staff.userId);
  if (!claimed) {
    const current = await service.store.getConversation(id);
    return claimConflictResponse(
      current?.claimedBy ? await staffName(service.db, current.claimedBy) : null,
    );
  }
  // Taking the conversation is handling it: the attention alert clears.
  await service.store.clearConversationAttention(id);
  // A successful Take over completes the conversation's open contact
  // request (ticket 69): the Chat ask that put the conversation in this
  // waiting state is done. The guarded update is a no-op when none is open.
  await service.store.completeOpenContactRequest(
    id,
    loaded.staff.userId,
    new Date().toISOString(),
  );
  await audit(service.store, loaded.staff.userId, "conversation_claimed", { conversationId: id });
  return NextResponse.json({ conversation: claimed });
}
