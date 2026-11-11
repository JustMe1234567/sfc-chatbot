import { NextResponse } from "next/server";
import { visitorAuthFailure, visitorConversation } from "@/api/visitor";
import { createRateLimiter, MESSAGE_RATE_LIMIT, validateVisitorContact } from "@/domain/limits";
import { hasAcceptedContact } from "@/domain/conversations";
import { isConversationActive } from "@/domain/activity";
import { getChatbotService } from "@/db/service";
import { withJsonErrors } from "@/api/serverError";

const contactLimiter = createRateLimiter(MESSAGE_RATE_LIMIT);

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Accepts the required contact details on an existing conversation (ticket
 * 66) — the unlock for a conversation the visitor already holds a credential
 * to but that carries none yet: the locked successor after Clear chat, or a
 * legacy session from before the gate. The visitor credential itself
 * authorizes the write. A closed or quiet conversation cannot be revived
 * this way; the widget starts a fresh chat with the same details instead.
 * Once accepted, details are settled for that conversation: a repeat is
 * answered without rewriting them, so a retried submission stays harmless.
 */
async function postHandler(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const conversation = await visitorConversation(request, id);
  if (!conversation) {
    return visitorAuthFailure(request);
  }
  if (conversation.state === "closed") {
    return NextResponse.json(
      {
        error: {
          code: "conversation_closed",
          message: "This conversation was closed. Start a new chat instead.",
        },
      },
      { status: 409 },
    );
  }
  if (!isConversationActive(conversation)) {
    return NextResponse.json(
      {
        error: {
          code: "conversation_inactive",
          message: "This conversation has gone quiet. Start a new chat instead.",
        },
      },
      { status: 409 },
    );
  }
  const validation = validateVisitorContact(await request.json().catch(() => null));
  if (!validation.ok) {
    return NextResponse.json(
      { error: { code: validation.code, message: validation.message } },
      { status: 400 },
    );
  }
  if (!contactLimiter.check(conversation.id)) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many requests. Please try again shortly." } },
      { status: 429 },
    );
  }

  const { store } = await getChatbotService();
  if (!hasAcceptedContact(conversation)) {
    await store.setConversationContact(conversation.id, validation.contact);
  }
  await store.touchVisitorPresence(conversation.id);
  return NextResponse.json({ id: conversation.id });
}

export const POST = withJsonErrors(postHandler);
