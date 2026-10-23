import { NextResponse } from "next/server";
import { getChatbotService } from "@/db/service";
import { visitorAuthFailure, visitorConversation } from "@/api/visitor";
import { matchAnswerRules, matchesEscalationPhrase } from "@/domain/matcher";
import { getEscalationPhrases, getSupportHours } from "@/settings";
import { handoffReply } from "@/domain/hours";
import {
  createRateLimiter,
  HISTORY_RATE_LIMIT,
  MESSAGE_RATE_LIMIT,
  validateVisitorText,
} from "@/domain/limits";
import type { Conversation, Message } from "@/domain/types";

const messageLimiter = createRateLimiter(MESSAGE_RATE_LIMIT);
const historyLimiter = createRateLimiter(HISTORY_RATE_LIMIT);

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
    return visitorAuthFailure(request);
  }
  if (!historyLimiter.check(conversation.id)) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many requests. Please try again shortly." } },
      { status: 429 },
    );
  }
  const { store } = await getChatbotService();
  // Every authorized read refreshes presence: the widget's polling keeps the
  // visitor marked as on the page, so staff replies don't email them (07).
  await store.touchVisitorPresence(conversation.id);
  const messages = await store.listMessages(conversation.id);
  return NextResponse.json({ conversation, messages });
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const conversation = await visitorConversation(request, id);
  if (!conversation) {
    return visitorAuthFailure(request);
  }
  const body = (await request.json().catch(() => null)) as {
    text?: unknown;
    choice?: unknown;
  } | null;

  // The visitor picked one of the bot's offered topics (ticket 06): the
  // selection answers from that exact published rule, so wording overlap can
  // never re-ambiguate the visitor's own choice. The transcript records the
  // picked topic as the visitor's words; no free text rides along.
  if (body?.choice !== undefined) {
    const invalidChoice = (): NextResponse =>
      NextResponse.json(
        { error: { code: "invalid_choice", message: "Pick one of the offered topics." } },
        { status: 400 },
      );
    if (typeof body.choice !== "string" || body.choice.length === 0) {
      return invalidChoice();
    }
    const { store } = await getChatbotService();
    const rule = await store.getAnswerRule(body.choice);
    if (!rule || rule.status !== "published") {
      return invalidChoice();
    }
    if (conversation.state === "closed") {
      return NextResponse.json(
        {
          error: {
            code: "conversation_closed",
            message: "This conversation was closed. Ask a new question to start again.",
          },
        },
        { status: 409 },
      );
    }
    if (!messageLimiter.check(conversation.id)) {
      return NextResponse.json(
        { error: { code: "rate_limited", message: "Too many questions. Please try again shortly." } },
        { status: 429 },
      );
    }
    await store.appendMessage(newMessage(conversation.id, "visitor", rule.topic));
    await store.touchVisitorPresence(conversation.id);
    if (conversation.state !== "bot_active") {
      // Staff help is already requested; bot replies stay paused.
      return NextResponse.json({ conversation, reply: null });
    }
    const reply = newMessage(conversation.id, "bot", rule.response, rule.link);
    await store.appendMessage(reply);
    return NextResponse.json({ conversation, reply });
  }

  const validation = validateVisitorText(body?.text);
  if (!validation.ok) {
    return NextResponse.json(
      { error: { code: validation.code, message: validation.message } },
      { status: 400 },
    );
  }
  if (conversation.state === "closed") {
    // The staff side closed this conversation; the visitor's next question
    // starts a fresh one with a new credential.
    return NextResponse.json(
      {
        error: {
          code: "conversation_closed",
          message: "This conversation was closed. Ask a new question to start again.",
        },
      },
      { status: 409 },
    );
  }
  if (!messageLimiter.check(conversation.id)) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many questions. Please try again shortly." } },
      { status: 429 },
    );
  }

  const { store, db, mail } = await getChatbotService();
  await store.appendMessage(newMessage(conversation.id, "visitor", validation.text));
  await store.touchVisitorPresence(conversation.id);

  // Once staff help is requested, automated answers pause for the rest of the
  // conversation; only one escalation is raised per conversation.
  if (conversation.state !== "bot_active") {
    return NextResponse.json({ conversation, reply: null });
  }

  // An unknown question and an explicit handoff phrase produce the same
  // escalation; alerting must never fail the visitor's response, and a failed
  // alert stays visible on the notifications page for retry.
  async function escalate(target: Conversation): Promise<Response> {
    const escalated: Conversation = { ...target, state: "awaiting_staff" };
    await store.updateConversationState(target.id, "awaiting_staff");
    const reply = newMessage(target.id, "bot", handoffReply(getSupportHours(db)));
    await store.appendMessage(reply);
    try {
      const { recordEscalationAlert } = await import("@/mail/notifications");
      await recordEscalationAlert(db, mail, target.id);
    } catch (error) {
      console.error("escalation alert recording failed:", error);
    }
    return NextResponse.json({ conversation: escalated, reply });
  }

  // Explicit handoff wording wins over every answer rule (ticket 06).
  if (matchesEscalationPhrase(validation.text, getEscalationPhrases(db))) {
    return escalate(conversation);
  }

  const rules = await store.listPublishedAnswerRules();
  const matches = matchAnswerRules(validation.text, rules);

  if (matches.length === 0) {
    return escalate(conversation);
  }
  if (matches.length === 1) {
    const rule = matches[0]!;
    const reply = newMessage(conversation.id, "bot", rule.response, rule.link);
    await store.appendMessage(reply);
    return NextResponse.json({ conversation, reply });
  }

  // Several plausible matches never guess: the bot offers the matching topics
  // as choices, and the visitor's selection answers from the chosen rule.
  const topicNames = matches.map((rule) => rule.topic).join(", ");
  const reply = newMessage(
    conversation.id,
    "bot",
    `That sounds like it could fit more than one of my topics: ${topicNames}. Pick the one closest to your question.`,
  );
  reply.choices = matches.map((rule) => ({ id: rule.id, topic: rule.topic }));
  await store.appendMessage(reply);
  return NextResponse.json({ conversation, reply });
}
