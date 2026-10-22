import express, { type ErrorRequestHandler, type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { matchAnswerRules } from "../domain/matcher";
import {
  createRateLimiter,
  CREATE_RATE_LIMIT,
  HISTORY_RATE_LIMIT,
  MESSAGE_RATE_LIMIT,
  validateVisitorText,
} from "../domain/limits";
import { createSessionToken, hashSessionToken } from "../domain/tokens";
import { repoRoot } from "../paths";
import type { Conversation, Message, Store } from "../domain/types";

/** Bot reply while no escalation flow exists yet (ticket 02 replaces this). */
const NO_ANSWER_REPLY = "Sorry, I don't have an approved answer for that question yet.";

interface AppOptions {
  store: Store;
}

function sendError(response: Response, status: number, code: string, message: string): void {
  response.status(status).json({ error: { code, message } });
}

function bearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Attaches the conversation the bearer token is entitled to, or responds
 * 401/404 and stops the handler. A token from another conversation gets 404 so
 * conversation existence is not leaked across visitors.
 */
function requireConversation(store: Store) {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    const token = bearerToken(request);
    if (!token) {
      sendError(response, 401, "unauthorized", "A visitor session is required.");
      return;
    }
    const authorizedId = await store.findConversationIdByTokenHash(hashSessionToken(token));
    // Route params can arrive as arrays in Express 5 typing; an id lookup only
    // ever wants the single string form.
    const rawId = request.params.id;
    const conversationId = Array.isArray(rawId) ? rawId.join(",") : (rawId ?? "");
    const conversation =
      authorizedId === conversationId ? await store.getConversation(conversationId) : null;
    if (!conversation) {
      sendError(response, 404, "conversation_not_found", "Conversation not found.");
      return;
    }
    response.locals.conversation = conversation;
    next();
  };
}

function conversationFrom(response: Response): Conversation {
  return response.locals.conversation as Conversation;
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

export function createApp({ store }: AppOptions) {
  const app = express();
  const messageLimiter = createRateLimiter(MESSAGE_RATE_LIMIT);
  const createLimiter = createRateLimiter(CREATE_RATE_LIMIT);
  const historyLimiter = createRateLimiter(HISTORY_RATE_LIMIT);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));

  // The widget is served cross-origin from the college WordPress site and
  // authorizes with an explicit bearer token, never cookies.
  app.use((request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (request.method === "OPTIONS") {
      response.sendStatus(204);
      return;
    }
    next();
  });

  app.get("/healthz", (_request, response) => {
    response.json({ ok: true });
  });

  app.post("/api/v1/conversations", async (request, response) => {
    if (!createLimiter.check(request.ip ?? "unknown")) {
      sendError(response, 429, "rate_limited", "Too many chats started. Please try again shortly.");
      return;
    }
    const conversation: Conversation = {
      id: crypto.randomUUID(),
      state: "bot_active",
      createdAt: new Date().toISOString(),
    };
    const token = createSessionToken();
    await store.createConversation(conversation);
    await store.createSession({
      tokenHash: hashSessionToken(token),
      conversationId: conversation.id,
      createdAt: new Date().toISOString(),
    });
    response.status(201).json({ id: conversation.id, token });
  });

  app.get(
    "/api/v1/conversations/:id/messages",
    requireConversation(store),
    async (request, response) => {
      const conversation = conversationFrom(response);
      if (!historyLimiter.check(conversation.id)) {
        sendError(response, 429, "rate_limited", "Too many requests. Please try again shortly.");
        return;
      }
      const messages = await store.listMessages(conversation.id);
      response.json({ messages });
    },
  );

  app.post(
    "/api/v1/conversations/:id/messages",
    requireConversation(store),
    async (request, response) => {
      const conversation = conversationFrom(response);
      const validation = validateVisitorText(
        (request.body as { text?: unknown } | undefined)?.text,
      );
      if (!validation.ok) {
        sendError(response, 400, validation.code, validation.message);
        return;
      }
      if (!messageLimiter.check(conversation.id)) {
        sendError(response, 429, "rate_limited", "Too many questions. Please try again shortly.");
        return;
      }

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
      response.json({ reply });
    },
  );

  app.use(express.static(path.join(repoRoot(), "public")));

  app.use((_request, response) => {
    sendError(response, 404, "not_found", "Not found.");
  });

  const jsonErrorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    if (error?.type === "entity.too.large") {
      sendError(response, 413, "too_large", "Request body is too large.");
      return;
    }
    const status = error?.type === "entity.parse.failed" || "body" in (error ?? {}) ? 400 : 500;
    sendError(
      response,
      status,
      status === 400 ? "invalid_json" : "internal_error",
      "Bad request.",
    );
  };
  app.use(jsonErrorHandler);

  return app;
}
