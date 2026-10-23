import { NextResponse } from "next/server";
import { sameOriginGuard } from "@/api/staff";
import { claimConflictResponse, loadStaffConversation } from "@/api/staffConversations";
import { activeInboxMember } from "@/api/staffMembers";
import { audit } from "@/api/audit";
import { getChatbotService } from "@/db/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Transfer (ticket 08): the claimer — or the owner role overriding — hands
 * the conversation to another active inbox-capable staff member. History is
 * untouched; the new owner can reply immediately.
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

  const body = (await request.json().catch(() => null)) as { to?: unknown } | null;
  const targetId = typeof body?.to === "string" ? body.to : "";
  if (targetId.length === 0) {
    return NextResponse.json(
      { error: { code: "invalid_target", message: "Choose a staff member to transfer to." } },
      { status: 400 },
    );
  }

  if (conversation.state !== "claimed") {
    return NextResponse.json(
      { error: { code: "invalid_state", message: "Only a claimed conversation can be transferred." } },
      { status: 409 },
    );
  }
  const isClaimer = conversation.claimedBy === staff.userId;
  if (!isClaimer && staff.role !== "owner") {
    return claimConflictResponse(claimerName);
  }

  const { store, db } = await getChatbotService();
  const target = activeInboxMember(db, targetId);
  // Transferring to the conversation's current owner is always a no-op: the
  // claimer picking themselves. (An owner overriding may take a conversation
  // over by transferring it to themselves.)
  if (!target || target.id === conversation.claimedBy) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_target",
          message: "Pick a different active staff member with inbox access.",
        },
      },
      { status: 400 },
    );
  }

  const transferred = await store.transferConversation(id, target.id);
  if (!transferred) {
    return NextResponse.json(
      { error: { code: "invalid_state", message: "This conversation is no longer claimed." } },
      { status: 409 },
    );
  }
  await audit(store, staff.userId, "conversation_transferred", { conversationId: id }, target.name);
  return NextResponse.json({ conversation: transferred, transferredTo: target.name });
}
