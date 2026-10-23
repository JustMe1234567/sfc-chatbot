import { NextResponse } from "next/server";
import { getChatbotService } from "@/db/service";
import { createRateLimiter, CREATE_RATE_LIMIT } from "@/domain/limits";
import { createSessionToken, hashSessionToken, sessionExpiry } from "@/domain/tokens";
import type { Conversation } from "@/domain/types";

const createLimiter = createRateLimiter(CREATE_RATE_LIMIT);

function clientKey(request: Request): string {
  // No trusted proxy in local development; production fronting proxies set
  // x-forwarded-for. Unknown callers share one bucket.
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export async function POST(request: Request) {
  const { store } = await getChatbotService();
  if (!createLimiter.check(clientKey(request))) {
    return NextResponse.json(
      {
        error: {
          code: "rate_limited",
          message: "Too many chats started. Please try again shortly.",
        },
      },
      { status: 429 },
    );
  }
  const conversation: Conversation = {
    id: crypto.randomUUID(),
    state: "bot_active",
    claimedBy: null,
    claimedAt: null,
    createdAt: new Date().toISOString(),
  };
  const token = createSessionToken();
  const createdAt = new Date().toISOString();
  const expiresAt = sessionExpiry();
  await store.createConversation(conversation);
  await store.createSession({
    tokenHash: hashSessionToken(token),
    conversationId: conversation.id,
    createdAt,
    expiresAt,
  });
  return NextResponse.json({ id: conversation.id, token, expiresAt }, { status: 201 });
}
