import { NextResponse } from "next/server";
import { getChatbotService } from "../db/service";
import { hashSessionToken } from "../domain/tokens";
import type { Conversation } from "../domain/types";

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * The shared failure for a visitor-authenticated request: 401 without a
 * credential, 404 otherwise so conversation existence is never leaked
 * across visitors.
 */
export function visitorAuthFailure(request: Request): NextResponse {
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

/**
 * Per-client key for public-endpoint rate limiting (ticket 20). The helper
 * itself lives in the leaf module the auth provider's sign-in path shares
 * (ticket 81); this re-export keeps every existing importer unchanged.
 */
export { publicClientKey } from "./clientKey";

/**
 * The conversation a bearer credential is entitled to, or null. A token that
 * belongs to a different conversation gets null (not 403) so conversation
 * existence is not leaked across visitors; callers respond 404.
 */
export async function visitorConversation(
  request: Request,
  conversationId: string,
): Promise<Conversation | null> {
  const token = bearerToken(request);
  if (!token) {
    return null;
  }
  const { store } = await getChatbotService();
  const authorizedId = await store.findConversationIdByTokenHash(hashSessionToken(token));
  if (authorizedId !== conversationId) {
    return null;
  }
  return store.getConversation(conversationId);
}
