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
 * Per-client key for public-endpoint rate limiting. No trusted proxy in
 * local development; production fronting proxies set x-forwarded-for.
 * Unknown callers share one bucket.
 */
export function publicClientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

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
