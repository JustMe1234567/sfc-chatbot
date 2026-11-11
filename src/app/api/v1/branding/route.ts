import { NextResponse } from "next/server";
import { publicClientKey } from "@/api/visitor";
import { createRateLimiter, TOPICS_RATE_LIMIT } from "@/domain/limits";
import { chatheadForeground, chatheadOuterSize } from "@/domain/branding";
import { getChatbotIconVersion, getChatheadConfig } from "@/settings";
import { getChatbotService } from "@/db/service";

const brandingLimiter = createRateLimiter(TOPICS_RATE_LIMIT);

/**
 * The public branding read (ticket 70): exactly the values the widget's
 * launcher and frame need to render the configured look — the versioned
 * icon URL and the chathead's appearance with its derived size and
 * automatic foreground. No settings beyond these, no session data, no
 * filesystem paths. Unconfigured or invalid values arrive as the bundled
 * defaults, so a failed fetch on the client side changes nothing.
 */
export async function GET(request: Request) {
  if (!brandingLimiter.check(publicClientKey(request))) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many requests. Please try again shortly." } },
      { status: 429 },
    );
  }
  const { db } = await getChatbotService();
  const [iconVersion, chathead] = await Promise.all([
    getChatbotIconVersion(db),
    getChatheadConfig(db),
  ]);
  return NextResponse.json({
    chatbotIconUrl: `/api/branding/chatbot-icon?v=${encodeURIComponent(iconVersion)}`,
    chathead: {
      backgroundColor: chathead.backgroundColor,
      iconSize: chathead.iconSize,
      padding: chathead.padding,
      outerSize: chatheadOuterSize(chathead),
      foreground: chatheadForeground(chathead.backgroundColor),
    },
  });
}
