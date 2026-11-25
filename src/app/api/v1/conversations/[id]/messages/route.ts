import { NextResponse } from "next/server";
import { getChatbotService } from "@/db/service";
import { visitorAuthFailure, visitorConversation } from "@/api/visitor";
import { matchAnswerRules, matchesEscalationPhrase, normalizeText } from "@/domain/matcher";
import {
  CONTACT_EMAIL_CHOICE,
  CONTACT_MEDIUM_PROMPT_TEXT,
  CONTACT_PHONE_CHOICE,
  HANDOFF_NO_CHOICE,
  HANDOFF_PROMPT_TEXT,
  HANDOFF_YES_CHOICE,
  contactRequestConfirmation,
  contactRequestOpenReply,
} from "@/domain/contactRequests";
import { getEscalationPhrases, getHandoffOptions, getSupportHours } from "@/settings";
import { handoffReply } from "@/domain/hours";
import { recordEscalation } from "@/domain/analytics";
import { isConversationActive, recordVisitorActivity } from "@/domain/activity";
import { hasAcceptedContact } from "@/domain/conversations";
import {
  createRateLimiter,
  HISTORY_RATE_LIMIT,
  MESSAGE_RATE_LIMIT,
  validateVisitorText,
} from "@/domain/limits";
import { createSharedRateLimiter } from "@/api/rateLimit";
import type { ContactRequest, Conversation, Message, Store } from "@/domain/types";
import { withJsonErrors } from "@/api/serverError";

const messageLimiter = createSharedRateLimiter(MESSAGE_RATE_LIMIT, "message");
const historyLimiter = createRateLimiter(HISTORY_RATE_LIMIT);
const REQUEST_HUMAN_CHOICE_ID = "request-human";
const REQUEST_HUMAN_CHOICE = {
  id: REQUEST_HUMAN_CHOICE_ID,
  topic: "Chat with a human",
};

/** The persisted confirmation's two actions (ticket 69), keyed by choice id. */
const CONTACT_ACTION_CHOICES: Record<string, string> = {
  [HANDOFF_YES_CHOICE.id]: HANDOFF_YES_CHOICE.topic,
  [HANDOFF_NO_CHOICE.id]: HANDOFF_NO_CHOICE.topic,
  [CONTACT_EMAIL_CHOICE.id]: CONTACT_EMAIL_CHOICE.topic,
  [CONTACT_PHONE_CHOICE.id]: CONTACT_PHONE_CHOICE.topic,
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
  const { store, db } = service;
  const escalated: Conversation = { ...target, state: "awaiting_staff" };
  await store.updateConversationState(target.id, "awaiting_staff");
  // First transition out of bot-active is the escalation the analytics
  // report counts (ticket 17); releases from a claim never pass here.
  await recordEscalation(db, store, new Date());
  const hours = await getSupportHours(db);
  const reply = newMessage(target.id, "bot", handoffReply(hours));
  await store.appendMessage(reply);
  return NextResponse.json({ conversation: escalated, reply });
}

/**
 * Creates the conversation's chat contact request (ticket 69): the visitor
 * chose "Yes, chat with staff" or clicked the unknown-question offer. The
 * guarded insert is the one-open-request guarantee — a losing concurrent or
 * repeated choice returns false, and the caller refuses with a stable 409.
 */
async function createChatRequest(
  store: Store,
  conversationId: string,
): Promise<boolean> {
  const request: ContactRequest = {
    id: crypto.randomUUID(),
    conversationId,
    medium: "chat",
    status: "open",
    createdAt: new Date().toISOString(),
    completedAt: null,
    completedBy: null,
  };
  return store.createContactRequest(request);
}

/** The 409 a repeated contact ask gets while one is open (ticket 69). */
function contactRequestOpenResponse(): NextResponse {
  return conflictResponse("contact_request_open", contactRequestOpenReply());
}

/**
 * The persisted two-action prompt (ticket 69): asked after a clicked
 * Handoff Option or a typed Handoff phrase. Nothing alerts and no request
 * exists until the visitor picks one of the choices.
 */
function handoffPromptMessage(conversationId: string): Message {
  const reply = newMessage(conversationId, "bot", HANDOFF_PROMPT_TEXT);
  reply.choices = [HANDOFF_YES_CHOICE, HANDOFF_NO_CHOICE];
  return reply;
}

/** The No path's follow-up: the two alternative media as choices. */
function contactMediumPromptMessage(conversationId: string): Message {
  const reply = newMessage(conversationId, "bot", CONTACT_MEDIUM_PROMPT_TEXT);
  reply.choices = [CONTACT_EMAIL_CHOICE, CONTACT_PHONE_CHOICE];
  return reply;
}

/**
 * Records a visitor's email-or-phone choice (ticket 69) and ends their chat
 * (ticket 104): one request with that medium, the masked-destination
 * confirmation with support-hours-aware wording — and then the visitor's
 * session is revoked while the conversation itself stays live server-side
 * (decision 1: not closed, no closing notice, no retention-clock start).
 * The confirmation is the transcript's last row of the ended chat; the
 * desk's Active view, Contact Me status, and Mark contacted keep working
 * until staff complete the request. The session-end applies only to
 * requests created by this flow — pre-existing open requests (follow-up 5b)
 * are untouched because nothing sweeps them.
 */
async function recordMediumRequest(
  conversation: Conversation,
  service: Awaited<ReturnType<typeof getChatbotService>>,
  medium: "email" | "phone",
): Promise<Response> {
  const { store, db } = service;
  const request: ContactRequest = {
    id: crypto.randomUUID(),
    conversationId: conversation.id,
    medium,
    status: "open",
    createdAt: new Date().toISOString(),
    completedAt: null,
    completedBy: null,
  };
  if (!(await store.createContactRequest(request))) {
    return contactRequestOpenResponse();
  }
  const hours = await getSupportHours(db);
  const destination = medium === "email" ? conversation.visitorEmail : conversation.visitorPhone;
  const reply = newMessage(
    conversation.id,
    "bot",
    contactRequestConfirmation(medium, destination ?? "", hours),
  );
  await store.appendMessage(reply);
  await store.revokeVisitorSessions(conversation.id);
  return NextResponse.json({ conversation, reply, sessionEnded: true });
}

/**
 * The shared visitor-input preflight (ticket 33): the closed and quiet-day
 * refusals, the rate limit, the visitor's words recorded, presence touched,
 * visitor activity marked, and the bot-active verdict. Every POST branch —
 * topic picks, the persisted confirmation's actions, handoff-option clicks,
 * and typed text — records through here, so the sequence cannot drift
 * between them. Returns the caller's failure response, or recorded:false
 * with the standard { conversation, reply: null } body when staff help is
 * already in play.
 */
async function recordVisitorChoice(
  conversation: Conversation,
  store: Store,
  text: string,
): Promise<{ recorded: true } | { recorded: false; response: NextResponse }> {
  if (conversation.state === "closed") {
    return {
      recorded: false,
      response: conflictResponse(
        "conversation_closed",
        "This conversation was closed. Ask a new question to start again.",
      ),
    };
  }
  if (!isConversationActive(conversation)) {
    return { recorded: false, response: inactiveResponse() };
  }
  if (!(await messageLimiter.check(conversation.id))) {
    return {
      recorded: false,
      response: NextResponse.json(
        { error: { code: "rate_limited", message: "Too many questions. Please try again shortly." } },
        { status: 429 },
      ),
    };
  }
  await store.appendMessage(newMessage(conversation.id, "visitor", text));
  await store.touchVisitorPresence(conversation.id);
  await recordVisitorActivity(store, conversation.id, new Date());
  if (conversation.state !== "bot_active") {
    return {
      recorded: false,
      response: NextResponse.json({ conversation, reply: null }),
    };
  }
  return { recorded: true };
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** The shared 409 shape for visitor conflicts: a stable code and a
 *  visitor-appropriate sentence. */
function conflictResponse(code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status: 409 });
}

/** The visitor is told when their chat has gone quiet (ticket 12). */
function inactiveResponse(): NextResponse {
  return conflictResponse(
    "conversation_inactive",
    "This conversation has gone quiet. Ask a new question to start again.",
  );
}

/** The contact gate (ticket 66): nothing a visitor submits — a typed
 *  question, a topic choice, or the human-handoff offer — is accepted until
 *  this conversation carries accepted contact details. The widget shows its
 *  form first; this stable error stops a direct request or a legacy session
 *  from getting past it. */
function contactRequiredResponse(): NextResponse {
  return conflictResponse(
    "contact_required",
    "Share your name, email, and phone number to start chatting.",
  );
}

async function getHandler(request: Request, context: RouteContext) {
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
  // Every authorized read refreshes presence (ticket 07): the widget's
  // polling keeps the visitor marked as on the page.
  await store.touchVisitorPresence(conversation.id);
  const messages = await store.listMessages(conversation.id);
  // The widget shows its contact form instead of the composer while this
  // conversation has no accepted details (ticket 66).
  return NextResponse.json({
    conversation,
    messages,
    contactRequired: !hasAcceptedContact(conversation),
  });
}

async function postHandler(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const conversation = await visitorConversation(request, id);
  if (!conversation) {
    return visitorAuthFailure(request);
  }
  if (!hasAcceptedContact(conversation)) {
    return contactRequiredResponse();
  }
  const body = (await request.json().catch(() => null)) as {
    text?: unknown;
    choice?: unknown;
    handoffOption?: unknown;
  } | null;

  // The visitor picked one of the bot's offered topics (ticket 06): the
  // selection answers from that exact published rule, so wording overlap can
  // never re-ambiguate the visitor's own choice. The transcript records the
  // picked topic as the visitor's words; no free text rides along.
  if (body?.choice !== undefined) {
    // No waiting lock (ticket 103): a choice posted while staff help is
    // requested falls through to the persisted-prompt staleness check
    // below, so only a choice whose prompt is still the last message can
    // fire — stale prompts refuse gracefully.
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
      const selection = await recordVisitorChoice(
        conversation,
        store,
        REQUEST_HUMAN_CHOICE.topic,
      );
      if (!selection.recorded) {
        return selection.response;
      }
      // The explicit one-click handoff (tickets 37/69): the click IS the
      // contact decision, so it also creates the Chat request and promotes
      // the temporary details — no second prompt on this path.
      if (!(await createChatRequest(store, conversation.id))) {
        return contactRequestOpenResponse();
      }
      return escalateConversation(conversation, service);
    }
    // The persisted confirmation's actions (ticket 69). Each validates that
    // its offer is still the last message — a stale prompt after more
    // conversation never fires — and the Yes path hands off exactly once.
    if (CONTACT_ACTION_CHOICES[body.choice] !== undefined) {
      const messages = await store.listMessages(conversation.id);
      const offered = messages.at(-1)?.choices?.some(
        (choice) => choice.id === body.choice,
      );
      if (!offered) {
        return invalidChoice();
      }
      const topic = CONTACT_ACTION_CHOICES[body.choice]!;
      if (body.choice === HANDOFF_YES_CHOICE.id) {
        const selection = await recordVisitorChoice(conversation, store, topic);
        if (!selection.recorded) {
          return selection.response;
        }
        if (!(await createChatRequest(store, conversation.id))) {
          return contactRequestOpenResponse();
        }
        return escalateConversation(conversation, service);
      }
      if (body.choice === HANDOFF_NO_CHOICE.id) {
        const selection = await recordVisitorChoice(conversation, store, topic);
        if (!selection.recorded) {
          return selection.response;
        }
        const reply = contactMediumPromptMessage(conversation.id);
        await store.appendMessage(reply);
        return NextResponse.json({ conversation, reply });
      }
      // Email or Phone: the medium request, with the bot staying active.
      const selection = await recordVisitorChoice(conversation, store, topic);
      if (!selection.recorded) {
        return selection.response;
      }
      return recordMediumRequest(
        conversation,
        service,
        body.choice === CONTACT_EMAIL_CHOICE.id ? "email" : "phone",
      );
    }
    const rule = await store.getAnswerRule(body.choice);
    if (!rule || rule.status !== "published") {
      return invalidChoice();
    }
    const selection = await recordVisitorChoice(conversation, store, rule.topic);
    if (!selection.recorded) {
      return selection.response;
    }
    const reply = newMessage(conversation.id, "bot", rule.response, rule.link);
    await store.appendMessage(reply);
    return NextResponse.json({ conversation, reply });
  }

  // The click of a configured click-to-handoff option (ticket 67, prompted
  // per ticket 69): the label is recorded as the visitor's words and the
  // persisted confirmation is asked — nothing escalates, alerts, or saves a
  // contact until the visitor chooses. Only the click reaches this branch:
  // typing the same wording keeps normal answer matching below.
  if (body?.handoffOption !== undefined) {
    // No waiting lock (ticket 103): a click while staff help is requested
    // is recorded as the visitor's words — the bot is paused, so it can
    // never raise a second handoff.
    const invalidOption = (): NextResponse =>
      NextResponse.json(
        {
          error: {
            code: "invalid_handoff_option",
            message: "That option isn't available. Type your question instead.",
          },
        },
        { status: 400 },
      );
    if (typeof body.handoffOption !== "string" || body.handoffOption.trim().length === 0) {
      return invalidOption();
    }
    const service = await getChatbotService();
    const { store, db } = service;
    const option = (await getHandoffOptions(db)).find(
      (candidate) => normalizeText(candidate) === normalizeText(body.handoffOption as string),
    );
    if (!option) {
      return invalidOption();
    }
    const selection = await recordVisitorChoice(conversation, store, option);
    if (!selection.recorded) {
      // Under an active claim the label lands as the visitor's words to
      // staff, exactly like a topic pick — with no new handoff raised.
      return selection.response;
    }
    // An open request answers truthfully instead of prompting again
    // (ticket 69): no duplicate ask, no second prompt.
    if (await store.getOpenContactRequest(conversation.id)) {
      const reply = newMessage(conversation.id, "bot", contactRequestOpenReply());
      await store.appendMessage(reply);
      return NextResponse.json({ conversation, reply });
    }
    const reply = handoffPromptMessage(conversation.id);
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
  // The typed path checks its conflicts up front, in this order — a closure
  // or a quiet day beats everything else — then records through the same
  // shared preflight the choice paths use (ticket 33), so the rate limit,
  // the record, presence, and the activity mark cannot drift between the
  // two paths. recordVisitorChoice's own closed/inactive re-checks are
  // no-ops on this unchanged snapshot.
  if (conversation.state === "closed") {
    // The staff side closed this conversation; the widget's contact form
    // returns and the visitor's next submission starts a fresh one (66).
    return conflictResponse(
      "conversation_closed",
      "This conversation was closed. Ask a new question to start again.",
    );
  }
  // Quiet for a day: the conversation is history now. The widget treats this
  // exactly like a closure — the contact form returns for a fresh chat (66).
  if (!isConversationActive(conversation)) {
    return inactiveResponse();
  }

  const service = await getChatbotService();
  const { store, db } = service;
  const selection = await recordVisitorChoice(conversation, store, validation.text);
  if (!selection.recorded) {
    return selection.response;
  }

  // Explicit handoff wording wins over every answer rule (ticket 06) — and
  // asks before acting (ticket 69): the typed phrase is recorded above, then
  // the persisted confirmation goes out. Nothing escalates until the
  // visitor picks a side of it.
  if (matchesEscalationPhrase(validation.text, await getEscalationPhrases(db))) {
    if (await store.getOpenContactRequest(conversation.id)) {
      const reply = newMessage(conversation.id, "bot", contactRequestOpenReply());
      await store.appendMessage(reply);
      return NextResponse.json({ conversation, reply });
    }
    const reply = handoffPromptMessage(conversation.id);
    await store.appendMessage(reply);
    return NextResponse.json({ conversation, reply });
  }

  const rules = await store.listPublishedAnswerRules();
  const matches = matchAnswerRules(validation.text, rules);

  if (matches.length === 0) {
    // The visitor-consented offer (ticket 37): one click hands off — and
    // since ticket 69 that click also creates the Chat request. While a
    // request is already open the offer hides: the desk is already on it.
    const reply = newMessage(
      conversation.id,
      "bot",
      "I don't have knowledge of that. You can chat with a human if you'd like.",
    );
    if (!(await store.getOpenContactRequest(conversation.id))) {
      reply.choices = [REQUEST_HUMAN_CHOICE];
    }
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

export const GET = withJsonErrors(getHandler);
export const POST = withJsonErrors(postHandler);
