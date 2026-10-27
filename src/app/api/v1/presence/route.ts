import { NextResponse } from "next/server";
import { getChatbotService } from "@/db/service";
import { sameOriginGuard } from "@/api/staff";
import { publicClientKey } from "@/api/visitor";
import { createRateLimiter, PRESENCE_RATE_LIMIT } from "@/domain/limits";
import { hashSessionToken } from "@/domain/tokens";
import { getAnalyticsRetentionDays } from "@/settings";
import { recordAnalyticsPresence } from "@/domain/analytics";
import { BROWSER_ID_PATTERN } from "@/widget/presence";

const presenceLimiter = createRateLimiter(PRESENCE_RATE_LIMIT);

/**
 * The anonymous presence heartbeat (ticket 17). The embedded widget posts a
 * random browser UUID about every 45 seconds while the host page is visible;
 * this endpoint counts the browser for the day and answers with the
 * analytics retention period so the client can rotate its identifier on
 * time. Requests are origin-checked and rate limited per client; nothing
 * about the caller — no IP, header, or fingerprint — is ever persisted, and
 * only a SHA-256 of the id is stored.
 */
export async function POST(request: Request) {
  const blocked = sameOriginGuard(request);
  if (blocked) {
    return blocked;
  }
  if (!presenceLimiter.check(publicClientKey(request))) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many requests. Please try again shortly." } },
      { status: 429 },
    );
  }
  const body = (await request.json().catch(() => null)) as { browserId?: unknown } | null;
  if (body === null || typeof body.browserId !== "string" || !BROWSER_ID_PATTERN.test(body.browserId)) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_browser_id",
          message: "A browser identifier is required.",
        },
      },
      { status: 400 },
    );
  }

  const { store, db } = await getChatbotService();
  // The identifier is a client-generated random UUID; only its hash is kept,
  // exactly like the visitor credentials it must never entangle with.
  const visitorHash = hashSessionToken(body.browserId);
  await recordAnalyticsPresence(db, store, visitorHash, new Date());
  return NextResponse.json({ retentionDays: getAnalyticsRetentionDays(db) });
}
