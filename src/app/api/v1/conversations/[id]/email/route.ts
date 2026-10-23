import { NextResponse } from "next/server";
import { visitorAuthFailure, visitorConversation } from "@/api/visitor";
import { createRateLimiter, MESSAGE_RATE_LIMIT, validateVisitorEmail } from "@/domain/limits";
import { getChatbotService } from "@/db/service";

const emailLimiter = createRateLimiter(MESSAGE_RATE_LIMIT);

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * The optional follow-up address, requested only at handoff (ticket 07): a
 * visitor still in live chat needs nothing, and a visitor who leaves can be
 * sent a secure link back. The visitor credential itself authorizes the
 * write; presence is refreshed because asking means they are on the page.
 */
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const conversation = await visitorConversation(request, id);
  if (!conversation) {
    return visitorAuthFailure(request);
  }
  if (conversation.state === "bot_active" || conversation.state === "closed") {
    return NextResponse.json(
      {
        error: {
          code: "invalid_state",
          message: "An email address is only collected once staff help is requested.",
        },
      },
      { status: 409 },
    );
  }
  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  const validation = validateVisitorEmail(body?.email);
  if (!validation.ok) {
    return NextResponse.json(
      { error: { code: validation.code, message: validation.message } },
      { status: 400 },
    );
  }
  if (!emailLimiter.check(conversation.id)) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many requests. Please try again shortly." } },
      { status: 429 },
    );
  }

  const { store } = await getChatbotService();
  await store.setConversationEmail(conversation.id, validation.email);
  await store.touchVisitorPresence(conversation.id);
  return NextResponse.json({ email: validation.email });
}
