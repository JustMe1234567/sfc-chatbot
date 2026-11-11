import { NextResponse } from "next/server";
import { visitorAuthFailure, visitorConversation } from "@/api/visitor";
import { createRateLimiter, MESSAGE_RATE_LIMIT } from "@/domain/limits";
import { CLOSING_NOTICE } from "@/domain/conversations";
import { recordChatStarted } from "@/domain/analytics";
import { createSessionToken, hashSessionToken, sessionExpiryFrom } from "@/domain/tokens";
import { getChatbotService } from "@/db/service";
import { withJsonErrors } from "@/api/serverError";

const clearLimiter = createRateLimiter(MESSAGE_RATE_LIMIT);

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * The visitor's Clear conversation action (ticket 14): ends this
 * conversation and hands back exactly one fresh one. The store transaction
 * closes the old transcript for staff (never deleting it), revokes the old
 * credential and unused return links, and links the successor so repeated
 * or retried requests return the same fresh chat instead of minting new
 * ones. The visitor's view starts blank; staff keep the record in History
 * under the usual retention policy.
 */
async function postHandler(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const conversation = await visitorConversation(request, id);
  if (!conversation) {
    return visitorAuthFailure(request);
  }
  if (!clearLimiter.check(conversation.id)) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many requests. Please try again shortly." } },
      { status: 429 },
    );
  }

  const at = new Date();
  const successorId = crypto.randomUUID();
  const token = createSessionToken();
  const expiresAt = sessionExpiryFrom(at);
  const { store, db } = await getChatbotService();
  const result = await store.replaceConversation(
    conversation.id,
    successorId,
    { tokenHash: hashSessionToken(token), createdAt: at.toISOString(), expiresAt },
    at.toISOString(),
    CLOSING_NOTICE,
  );
  if (!result) {
    return visitorAuthFailure(request);
  }
  // The fresh conversation is a chat created too (ticket 17) — but only when
  // this request minted it: a retried clear that joins an existing successor
  // must not count a second chat.
  if (result.created) {
    await recordChatStarted(db, store, at);
  }
  return NextResponse.json({ id: result.successorId, token, expiresAt });
}

export const POST = withJsonErrors(postHandler);
