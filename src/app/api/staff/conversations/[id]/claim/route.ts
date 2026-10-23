import { NextResponse } from "next/server";
import { sameOriginGuard } from "@/api/staff";
import { claimConflictResponse, loadStaffConversation, staffName } from "@/api/staffConversations";
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
      { error: { code: "invalid_state", message: "This conversation is not waiting for staff." } },
      { status: 409 },
    );
  }

  const service = await getChatbotService();
  const claimed = await service.store.claimConversation(id, loaded.staff.userId);
  if (!claimed) {
    const current = await service.store.getConversation(id);
    return claimConflictResponse(
      current?.claimedBy ? staffName(service.db, current.claimedBy) : null,
    );
  }
  return NextResponse.json({ conversation: claimed });
}
