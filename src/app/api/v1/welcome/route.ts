import { NextResponse } from "next/server";
import { getChatbotService } from "@/db/service";
import { publicClientKey } from "@/api/visitor";
import { createRateLimiter, TOPICS_RATE_LIMIT } from "@/domain/limits";
import { getWelcomeMessage } from "@/settings";
import { withJsonErrors } from "@/api/serverError";

// Same bar as the topics strip: a public, credential-free read a fresh
// widget performs on every open.
const welcomeLimiter = createRateLimiter(TOPICS_RATE_LIMIT);

/**
 * The published fresh-chat greeting (ticket 41): public and credential-free
 * so a dashboard edit reaches the visitor's next widget open without a
 * redeploy. The widget renders it locally; opening the widget never creates
 * a conversation or visitor credential.
 */
async function getHandler(request: Request) {
  if (!welcomeLimiter.check(publicClientKey(request))) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many requests. Please try again shortly." } },
      { status: 429 },
    );
  }
  const { db } = await getChatbotService();
  return NextResponse.json({ text: await getWelcomeMessage(db) });
}

export const GET = withJsonErrors(getHandler);
