import { NextResponse } from "next/server";
import { getChatbotService } from "@/db/service";
import { publicClientKey } from "@/api/visitor";
import { topicButtonFor } from "@/domain/answerRules";
import { createRateLimiter, TOPICS_RATE_LIMIT } from "@/domain/limits";
import { withJsonErrors } from "@/api/serverError";

const topicsLimiter = createRateLimiter(TOPICS_RATE_LIMIT);

/**
 * The published topic buttons a widget renders before any conversation
 * exists: public, credential-free, and re-fetched on every widget open, so
 * publishing a rule changes the visitor experience without a redeploy. A
 * click sends `question` (the rule's first phrase) through the normal
 * question path, where the deterministic matcher resolves it.
 */
async function getHandler(request: Request) {
  if (!topicsLimiter.check(publicClientKey(request))) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many requests. Please try again shortly." } },
      { status: 429 },
    );
  }
  const { store } = await getChatbotService();
  const rules = await store.listPublishedAnswerRules();
  const topics = rules
    .map((rule) => ({ id: rule.id, ...topicButtonFor(rule) }))
    .sort((a, b) => a.topic.localeCompare(b.topic));
  return NextResponse.json({ topics });
}

export const GET = withJsonErrors(getHandler);
