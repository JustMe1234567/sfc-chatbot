import { NextResponse } from "next/server";
import { requireStaff } from "@/api/staff";
import { STAFF_ROLES } from "@/auth/server";
import { getChatbotService } from "@/db/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Full transcript of one escalated conversation for signed-in staff. */
export async function GET(request: Request, context: RouteContext) {
  const guard = await requireStaff(request.headers, { roles: STAFF_ROLES });
  if ("response" in guard) {
    return guard.response;
  }

  const { id } = await context.params;
  const { store } = await getChatbotService();
  const conversation = await store.getConversation(id);
  if (!conversation) {
    return NextResponse.json(
      { error: { code: "conversation_not_found", message: "Conversation not found." } },
      { status: 404 },
    );
  }
  const messages = await store.listMessages(conversation.id);
  return NextResponse.json({ conversation, messages });
}
