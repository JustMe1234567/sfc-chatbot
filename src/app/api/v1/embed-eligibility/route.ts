import { NextResponse } from "next/server";
import { getChatbotService } from "@/db/service";
import { publicClientKey } from "@/api/visitor";
import { getEmbedAllowlistOrigins } from "@/settings";
import { trustedOrigins } from "@/config";
import {
  isEmbedOriginAllowed,
  normalizeCandidateParentOrigin,
} from "@/domain/embedAllowlist";
import { createRateLimiter, TOPICS_RATE_LIMIT } from "@/domain/limits";
import { withJsonErrors } from "@/api/serverError";

const eligibilityLimiter = createRateLimiter(TOPICS_RATE_LIMIT);

/**
 * One candidate parent origin for the eligibility decision (ticket 76): the
 * host page's own report via the loader's query parameter, falling back to
 * the browser-set Origin or Referer headers when the parameter is absent.
 * Headers are derivation only — the frame-ancestors policy, not this route,
 * is what a lying caller cannot bypass.
 */
function candidateOriginFrom(request: Request): string | null {
  const url = new URL(request.url);
  const param = url.searchParams.get("origin");
  if (param !== null && param.trim().length > 0) {
    return normalizeCandidateParentOrigin(param);
  }
  const originHeader = request.headers.get("origin");
  if (originHeader) {
    return normalizeCandidateParentOrigin(originHeader);
  }
  const referer = request.headers.get("referer");
  if (referer) {
    return normalizeCandidateParentOrigin(referer);
  }
  return null;
}

/**
 * The public embed eligibility check (ticket 76): before the widget loader
 * touches the host page it asks whether that page's origin may host the
 * widget, and the answer is deliberately nothing but a boolean. The full
 * allowlist never leaves the server, a malformed, missing, or unverifiable
 * candidate simply reads as denied, and the wildcard CORS header is safe
 * because the response carries no credentials and no data beyond the
 * one-bit decision. A denial is a 200 with `allowed: false` — to the host
 * page a refusal and a failure are indistinguishable, and both render
 * nothing.
 */
async function getHandler(request: Request) {
  if (!eligibilityLimiter.check(publicClientKey(request))) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many requests. Please try again shortly." } },
      { status: 429, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
  const candidate = candidateOriginFrom(request);
  const { db } = await getChatbotService();
  const storedOrigins = await getEmbedAllowlistOrigins(db);
  const production = process.env.NODE_ENV === "production";
  // The decision ignores the extra list in production, so the trusted
  // origins ride along unconditionally — the same shape the proxy's
  // ancestors decision takes.
  const allowed = isEmbedOriginAllowed(candidate, storedOrigins, trustedOrigins(), production);
  return NextResponse.json(
    { allowed },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      },
    },
  );
}

export const GET = withJsonErrors(getHandler);
