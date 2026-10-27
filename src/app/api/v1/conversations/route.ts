import { NextResponse } from "next/server";
import { getChatbotService } from "@/db/service";
import { publicClientKey } from "@/api/visitor";
import { createRateLimiter, CREATE_RATE_LIMIT } from "@/domain/limits";
import { createSessionToken, hashSessionToken, sessionExpiry } from "@/domain/tokens";
import { recordChatStarted } from "@/domain/analytics";
import type { Conversation } from "@/domain/types";

const createLimiter = createRateLimiter(CREATE_RATE_LIMIT);

export async function POST(request: Request) {
  const { store, db } = await getChatbotService();
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
  const conversationCreatedAt = new Date().toISOString();
  const conversation: Conversation = {
    id: crypto.randomUUID(),
    state: "bot_active",
    claimedBy: null,
    claimedAt: null,
    visitorEmail: null,
    visitorLastSeenAt: null,
    closedAt: null,
    replacedBy: null,
    // A conversation with no messages is active for a day from creation.
    lastActivityAt: conversationCreatedAt,
    attentionAt: null,
    createdAt: conversationCreatedAt,
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
  // A conversation created is a chat started (ticket 17): the rollup keeps
  // counting after the transcript itself is eventually purged.
  await recordChatStarted(db, store, new Date(conversationCreatedAt));
  return NextResponse.json({ id: conversation.id, token, expiresAt }, { status: 201 });
}
