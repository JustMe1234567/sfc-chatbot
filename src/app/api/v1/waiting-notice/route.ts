import { NextResponse } from "next/server";
import { getChatbotService } from "@/db/service";
import { publicClientKey } from "@/api/visitor";
import { createRateLimiter, TOPICS_RATE_LIMIT } from "@/domain/limits";
import { getWaitingNotice } from "@/settings";
import { withJsonErrors } from "@/api/serverError";

// Same bar as the topics strip: a public, credential-free read a fresh
// widget performs on every open.
const waitingNoticeLimiter = createRateLimiter(TOPICS_RATE_LIMIT);

/**
 * The published handoff waiting notice (ticket 103): public and
 * credential-free so a dashboard edit reaches the visitor's next widget
 * open without a redeploy. The widget renders it as the small, centered
 * in-transcript line while an advisor is joining; opening the widget never
 * creates a conversation or visitor credential.
 */
async function getHandler(request: Request) {
  if (!waitingNoticeLimiter.check(publicClientKey(request))) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many requests. Please try again shortly." } },
      { status: 429 },
    );
  }
  const { db } = await getChatbotService();
  return NextResponse.json({ text: await getWaitingNotice(db) });
}

export const GET = withJsonErrors(getHandler);
