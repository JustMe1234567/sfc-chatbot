import { NextResponse } from "next/server";
import { sameOriginGuard } from "@/api/staff";
import { audit } from "@/api/audit";
import { claimConflictResponse, loadStaffConversation } from "@/api/staffConversations";
import { validateVisitorText } from "@/domain/limits";
import { getChatbotService } from "@/db/service";
import type { Message } from "@/domain/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Staff reply inside the visitor's chat. The current claimer may speak, and
 * the owner role may override the assignment (ticket 08) — never the
 * conversation state. Unlike the public visitor route there is no rate
 * limit: callers are authenticated staff, and the audit trail covers abuse
 * accountability.
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
      {
        error: {
          code: "invalid_state",
          message: "Claim the conversation before replying.",
        },
      },
      { status: 409 },
    );
  }
  // The claimer speaks; the owner role may override the assignment (ticket
  // 08) but never the conversation state itself.
  if (conversation.claimedBy !== staff.userId && staff.role !== "owner") {
    return claimConflictResponse(claimerName);
  }
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const validation = validateVisitorText(body?.text);
  if (!validation.ok) {
    return NextResponse.json(
      { error: { code: validation.code, message: validation.message } },
      { status: 400 },
    );
  }

  const message: Message = {
    id: crypto.randomUUID(),
    conversationId: id,
    role: "staff",
    text: validation.text,
    createdAt: new Date().toISOString(),
  };
  const service = await getChatbotService();
  await service.store.appendMessage(message);
  await audit(service.store, staff.userId, "conversation_replied", { conversationId: id });
  // A visitor who already left gets their one secure return link (ticket 07).
  // Notification failures never fail the reply itself; the notifications page
  // shows the failure for retry, like escalation alerts.
  try {
    const { maybeSendVisitorReturn } = await import("@/mail/visitorReturn");
    const fresh = await service.store.getConversation(id);
    if (fresh) {
      await maybeSendVisitorReturn(service, fresh);
    }
  } catch (error) {
    console.error("visitor return notification failed:", error);
  }
  return NextResponse.json({ message });
}
