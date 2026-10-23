import { NextResponse } from "next/server";
import { getChatbotService } from "@/db/service";
import { publicClientKey } from "@/api/visitor";
import { createRateLimiter, CREATE_RATE_LIMIT } from "@/domain/limits";
import { createSessionToken, hashSessionToken, sessionExpiry } from "@/domain/tokens";
import type { Conversation } from "@/domain/types";

const createLimiter = createRateLimiter(CREATE_RATE_LIMIT);

export async function POST(request: Request) {
  const { store } = await getChatbotService();
  if (!createLimiter.check(publicClientKey(request))) {
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
    visitorEmail: null,
    visitorLastSeenAt: null,
    closedAt: null,
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
