import { NextResponse } from "next/server";
import { getChatbotService } from "@/db/service";
import { visitorAuthFailure, visitorConversation } from "@/api/visitor";
import { matchAnswerRules, matchesEscalationPhrase } from "@/domain/matcher";
import { getEscalationPhrases, getSupportHours } from "@/settings";
import { handoffReply } from "@/domain/hours";
import { recordEscalation } from "@/domain/analytics";
import { isConversationActive, recordVisitorActivity } from "@/domain/activity";
import {
  createRateLimiter,
  HISTORY_RATE_LIMIT,
  MESSAGE_RATE_LIMIT,
  validateVisitorText,
} from "@/domain/limits";
import type { Conversation, Message } from "@/domain/types";

const messageLimiter = createRateLimiter(MESSAGE_RATE_LIMIT);
const historyLimiter = createRateLimiter(HISTORY_RATE_LIMIT);
const REQUEST_HUMAN_CHOICE_ID = "request-human";
const REQUEST_HUMAN_CHOICE = {
  id: REQUEST_HUMAN_CHOICE_ID,
  topic: "Chat with a human",
};

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

async function escalateConversation(
  target: Conversation,
  service: Awaited<ReturnType<typeof getChatbotService>>,
): Promise<Response> {
  const { store, db, mail } = service;
  const escalated: Conversation = { ...target, state: "awaiting_staff" };
  await store.updateConversationState(target.id, "awaiting_staff");
  // First transition out of bot-active is the escalation the analytics
  // report counts (ticket 17); releases from a claim never pass here.
  await recordEscalation(db, store, new Date());
  const hours = await getSupportHours(db);
  const reply = newMessage(target.id, "bot", handoffReply(hours));
  await store.appendMessage(reply);
  try {
    const { recordEscalationAlert } = await import("@/mail/notifications");
    await recordEscalationAlert(db, mail, target.id);
  } catch (error) {
    console.error("escalation alert recording failed:", error);
  }
  return NextResponse.json({ conversation: escalated, reply });
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** The visitor is told when their chat has gone quiet (ticket 12). */
function inactiveResponse(): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: "conversation_inactive",
        message: "This conversation has gone quiet. Ask a new question to start again.",
      },
    },
    { status: 409 },
  );
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
    const service = await getChatbotService();
    const { store } = service;
    if (body.choice === REQUEST_HUMAN_CHOICE_ID) {
      const messages = await store.listMessages(conversation.id);
      const offered = messages.at(-1)?.choices?.some(
        (choice) => choice.id === REQUEST_HUMAN_CHOICE_ID,
      );
      if (!offered) {
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
      if (!isConversationActive(conversation)) {
        return inactiveResponse();
      }
      if (!messageLimiter.check(conversation.id)) {
        return NextResponse.json(
          { error: { code: "rate_limited", message: "Too many questions. Please try again shortly." } },
          { status: 429 },
        );
      }
      await store.appendMessage(
        newMessage(conversation.id, "visitor", REQUEST_HUMAN_CHOICE.topic),
      );
      await store.touchVisitorPresence(conversation.id);
      await recordVisitorActivity(store, conversation.id, new Date());
      if (conversation.state !== "bot_active") {
        return NextResponse.json({ conversation, reply: null });
      }
      return escalateConversation(conversation, service);
    }
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
    if (!isConversationActive(conversation)) {
      return inactiveResponse();
    }
    if (!messageLimiter.check(conversation.id)) {
      return NextResponse.json(
        { error: { code: "rate_limited", message: "Too many questions. Please try again shortly." } },
        { status: 429 },
      );
    }
    const now = new Date();
    await store.appendMessage(newMessage(conversation.id, "visitor", rule.topic));
    await store.touchVisitorPresence(conversation.id);
    await recordVisitorActivity(store, conversation.id, now);
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
  // Quiet for a day: the conversation is history now. The widget treats this
  // exactly like a closure — fresh conversation, question carried over.
  if (!isConversationActive(conversation)) {
    return inactiveResponse();
  }
  if (!messageLimiter.check(conversation.id)) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many questions. Please try again shortly." } },
      { status: 429 },
    );
  }

  const service = await getChatbotService();
  const { store, db } = service;
  await store.appendMessage(newMessage(conversation.id, "visitor", validation.text));
  await store.touchVisitorPresence(conversation.id);
  await recordVisitorActivity(store, conversation.id, new Date());

  // Once staff help is requested, automated answers pause for the rest of the
  // conversation; only one escalation is raised per conversation.
  if (conversation.state !== "bot_active") {
    return NextResponse.json({ conversation, reply: null });
  }

  // Explicit handoff wording wins over every answer rule (ticket 06).
  if (matchesEscalationPhrase(validation.text, await getEscalationPhrases(db))) {
    return escalateConversation(conversation, service);
  }

  const rules = await store.listPublishedAnswerRules();
  const matches = matchAnswerRules(validation.text, rules);

  if (matches.length === 0) {
    const reply = newMessage(
      conversation.id,
      "bot",
      "I don't have knowledge of that. You can chat with a human if you'd like.",
    );
    reply.choices = [REQUEST_HUMAN_CHOICE];
    await store.appendMessage(reply);
    return NextResponse.json({ conversation, reply });
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
