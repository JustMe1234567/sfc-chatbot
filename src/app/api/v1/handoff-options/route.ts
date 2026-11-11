import { NextResponse } from "next/server";
import { getChatbotService } from "@/db/service";
import { publicClientKey } from "@/api/visitor";
import { getHandoffOptions } from "@/settings";
import { createRateLimiter, TOPICS_RATE_LIMIT } from "@/domain/limits";
import { withJsonErrors } from "@/api/serverError";

const optionsLimiter = createRateLimiter(TOPICS_RATE_LIMIT);

/**
 * The click-to-handoff options a widget offers (ticket 67): public,
 * credential-free, and re-fetched on every widget open like the topic
 * buttons, so an editor's change reaches visitors without a redeploy. The
 * options carry no names, emails, or phone numbers — only the configured
 * wordings. Clicking one posts the option back as `handoffOption`, a
 * deliberately distinct request from typed text, which keeps following
 * normal answer matching.
 */
async function getHandler(request: Request) {
  if (!optionsLimiter.check(publicClientKey(request))) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many requests. Please try again shortly." } },
      { status: 429 },
    );
  }
  const { db } = await getChatbotService();
  return NextResponse.json({ options: await getHandoffOptions(db) });
}

export const GET = withJsonErrors(getHandler);
