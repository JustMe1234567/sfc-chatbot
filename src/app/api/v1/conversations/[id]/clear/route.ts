import { NextResponse } from "next/server";
import { visitorAuthFailure, visitorConversation } from "@/api/visitor";
import { createRateLimiter, MESSAGE_RATE_LIMIT } from "@/domain/limits";
import { CLOSING_NOTICE } from "@/domain/conversations";
import { createSessionToken, hashSessionToken, sessionExpiryFrom } from "@/domain/tokens";
import { getChatbotService } from "@/db/service";

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
export async function POST(request: Request, context: RouteContext) {
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
  const { store } = await getChatbotService();
  const resolvedId = await store.replaceConversation(
    conversation.id,
    successorId,
    { tokenHash: hashSessionToken(token), createdAt: at.toISOString(), expiresAt },
    at.toISOString(),
    CLOSING_NOTICE,
  );
  if (!resolvedId) {
    return visitorAuthFailure(request);
  }
  return NextResponse.json({ id: resolvedId, token, expiresAt });
}
