import { NextResponse } from "next/server";
import { publicClientKey } from "@/api/visitor";
import { createSharedRateLimiter } from "@/api/rateLimit";
import { RETURN_RATE_LIMIT } from "@/domain/limits";
import { createSessionToken, hashSessionToken, sessionExpiry } from "@/domain/tokens";
import { getChatbotService } from "@/db/service";

const returnLimiter = createSharedRateLimiter(RETURN_RATE_LIMIT, "return");

/**
 * Redeems a mailed return link (ticket 07). Exactly one redemption is
 * accepted while the link is unexpired; it mints a fresh, conversation-scoped
 * visitor credential, so the returned visitor resumes their own history and
 * nothing else. Unknown, used, or expired links all answer 410 — the link is
 * gone, not retryable.
 */
export async function POST(request: Request) {
  if (!(await returnLimiter.check(publicClientKey(request)))) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many attempts. Please try again shortly." } },
      { status: 429 },
    );
  }
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  if (typeof body?.token !== "string" || body.token.length === 0 || body.token.length > 200) {
    return NextResponse.json(
      { error: { code: "invalid_token", message: "Open the link from your email." } },
      { status: 400 },
    );
  }

  // A returning visitor is present again: the transactional redeem burns the
  // link and mints a fresh, conversation-scoped credential together.
  const token = createSessionToken();
  const now = new Date().toISOString();
  const expiresAt = sessionExpiry();
  const { store } = await getChatbotService();
  const conversationId = await store.redeemReturnToken(hashSessionToken(body.token), {
    tokenHash: hashSessionToken(token),
    createdAt: now,
    expiresAt,
  });
  if (!conversationId) {
    return NextResponse.json(
      {
        error: {
          code: "return_link_invalid",
          message: "This link has expired or was already used. Start a new chat instead.",
        },
      },
      { status: 410 },
    );
  }
  await store.touchVisitorPresence(conversationId);
  return NextResponse.json({ id: conversationId, token, expiresAt });
}
