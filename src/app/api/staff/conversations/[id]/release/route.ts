import { NextResponse } from "next/server";
import { sameOriginGuard } from "@/api/staff";
import { claimConflictResponse, loadStaffConversation } from "@/api/staffConversations";
import { audit } from "@/api/audit";
import { getChatbotService } from "@/db/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Release (ticket 08): the claimer — or the admin role overriding — hands the
 * conversation back to the shared inbox, keeping all history for whoever
 * claims it next. The visitor's widget reflects the awaiting-staff state on
 * its next poll.
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

  if (conversation.state !== "claimed") {
    return NextResponse.json(
      { error: { code: "invalid_state", message: "Only a claimed conversation can be released." } },
      { status: 409 },
    );
  }
  const isClaimer = conversation.claimedBy === staff.userId;
  if (!isClaimer && staff.role !== "admin") {
    return claimConflictResponse(claimerName);
  }

  const { store } = await getChatbotService();
  const released = await store.releaseConversation(id);
  if (!released) {
    // Lost a race with another release or close; the caller can re-read.
    return NextResponse.json(
      { error: { code: "invalid_state", message: "This conversation is no longer claimed." } },
      { status: 409 },
    );
  }
  await audit(store, staff.userId, "conversation_released", { conversationId: id });
  return NextResponse.json({ conversation: released });
}
