import { NextResponse } from "next/server";
import { getChatbotService } from "@/db/service";
import { bearerToken, visitorConversation } from "@/api/visitor";
import { matchAnswerRules } from "@/domain/matcher";
import {
  createRateLimiter,
  HISTORY_RATE_LIMIT,
  MESSAGE_RATE_LIMIT,
  validateVisitorText,
} from "@/domain/limits";
import type { Message } from "@/domain/types";

const messageLimiter = createRateLimiter(MESSAGE_RATE_LIMIT);
const historyLimiter = createRateLimiter(HISTORY_RATE_LIMIT);

/** Bot reply while no escalation flow exists yet (ticket 02 replaces this). */
const NO_ANSWER_REPLY = "Sorry, I don't have an approved answer for that question yet.";

function authFailureResponse(request: Request): NextResponse {
  if (!bearerToken(request)) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "A visitor session is required." } },
      { status: 401 },
    );
  }
  return NextResponse.json(
    { error: { code: "conversation_not_found", message: "Conversation not found." } },
    { status: 404 },
  );
}

function newMessage(
  conversationId: string,
  role: Message["role"],
  text: string,
  link?: string,
): Message {
  return {
    id: crypto.randomUUID(),
    conversationId,
    role,
    text,
    ...(link ? { link } : {}),
    createdAt: new Date().toISOString(),
  };
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const conversation = await visitorConversation(request, id);
  if (!conversation) {
    return authFailureResponse(request);
  }
  if (!historyLimiter.check(conversation.id)) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many requests. Please try again shortly." } },
      { status: 429 },
    );
  }
  const { store } = await getChatbotService();
  const messages = await store.listMessages(conversation.id);
  return NextResponse.json({ messages });
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const conversation = await visitorConversation(request, id);
  if (!conversation) {
    return authFailureResponse(request);
  }
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const validation = validateVisitorText(body?.text);
  if (!validation.ok) {
    return NextResponse.json(
      { error: { code: validation.code, message: validation.message } },
      { status: 400 },
    );
  }
  if (!messageLimiter.check(conversation.id)) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many questions. Please try again shortly." } },
      { status: 429 },
    );
  }

  const { store } = await getChatbotService();
  await store.appendMessage(newMessage(conversation.id, "visitor", validation.text));

  const rules = await store.listPublishedAnswerRules();
  const matches = matchAnswerRules(validation.text, rules);
  // Exactly one match answers; zero or several matches never guess. Ticket 06
  // turns several matches into topic choices.
  const rule = matches.length === 1 ? matches[0] : undefined;
  const reply = newMessage(
    conversation.id,
    "bot",
    rule ? rule.response : NO_ANSWER_REPLY,
    rule?.link,
  );
  await store.appendMessage(reply);
  return NextResponse.json({ reply });
}
