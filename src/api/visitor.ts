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
 * Per-client key for public-endpoint rate limiting (ticket 20).
 *
 * In production the key comes only from platform-set headers, on the
 * assumption documented in Vercel's request-header reference: the Vercel
 * edge overwrites x-forwarded-for and does not forward external IPs, and
 * x-vercel-forwarded-for carries that same platform-computed value even when
 * another proxy sits on top of Vercel (x-real-ip matches it there too, and
 * is the conventional trusted header on other reverse proxies). The
 * client-controllable leftmost x-forwarded-for entry is never trusted in
 * production — a caller able to rotate that header must not be able to
 * rotate its rate-limit identity — so a production platform that sets none
 * of the trusted headers leaves every caller in one shared bucket.
 *
 * Local development keeps the pre-platform behavior: the first
 * x-forwarded-for entry acts as the client key (behind a dev proxy that
 * appends), and with no forwarded headers at all every caller shares one
 * bucket.
 */
export function publicClientKey(request: Request): string {
  if (process.env.NODE_ENV === "production") {
    return (
      request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip")?.trim() ||
      "local"
    );
  }
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
