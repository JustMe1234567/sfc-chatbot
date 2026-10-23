import { NextResponse } from "next/server";
import { requireStaff } from "@/api/staff";
import { STAFF_ROLES } from "@/auth/server";
import { auditWithNames } from "@/api/audit";
import { getChatbotService } from "@/db/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Full transcript and accountability trail for one escalated conversation. */
export async function GET(request: Request, context: RouteContext) {
  const guard = await requireStaff(request.headers, { roles: STAFF_ROLES });
  if ("response" in guard) {
    return guard.response;
  }

  const { id } = await context.params;
  const { store, db } = await getChatbotService();
  const conversation = await store.getConversation(id);
  if (!conversation) {
    return NextResponse.json(
      { error: { code: "conversation_not_found", message: "Conversation not found." } },
      { status: 404 },
    );
  }
  const messages = await store.listMessages(conversation.id);
  const auditEntries = auditWithNames(db, await store.listConversationAudit(conversation.id));
  return NextResponse.json({ conversation, messages, audit: auditEntries });
}
