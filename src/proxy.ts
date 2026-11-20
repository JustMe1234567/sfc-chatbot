import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { trustedOrigins } from "./config";
import { getChatbotService } from "./db/service";
import { getEmbedAllowlistOrigins } from "./settings";
import {
  isStandaloneFrameNavigation,
  resolveFrameAncestors,
} from "./domain/embedAllowlist";

/**
 * The widget frame's own request guards (ticket 76), layered behind the
 * loader's eligibility check: production standalone navigation is refused
 * outright, and every frame response carries the current allowlist as a
 * browser-enforced frame-ancestors policy, so copied or modified loader
 * code cannot authorize an unauthorized parent. Runs before rendering — a
 * refused request never reaches the page at all.
 */
async function widgetFrameResponse(request: NextRequest): Promise<NextResponse> {
  const production = process.env.NODE_ENV === "production";
  if (isStandaloneFrameNavigation(request.headers.get("sec-fetch-dest"), production)) {
    return new NextResponse(null, { status: 404 });
  }
  const { db } = await getChatbotService();
  const origins = await getEmbedAllowlistOrigins(db);
  const response = NextResponse.next({ request });
  response.headers.set(
    "Content-Security-Policy",
    resolveFrameAncestors(origins, trustedOrigins(), production),
  );
  // The policy must always reflect the allowlist as it stands now, so the
  // frame response never serves from a cache holding a stale decision.
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/widget/frame") {
    return widgetFrameResponse(request);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required for staff authentication.",
    );
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookies) {
        for (const cookie of cookies) request.cookies.set(cookie.name, cookie.value);
        response = NextResponse.next({ request });
        for (const cookie of cookies) response.cookies.set(cookie.name, cookie.value, cookie.options);
      },
    },
  });

  // Refresh only. Authorization remains in requireStaff(), where the live
  // Auth session and application-owned staff record are checked together.
  await supabase.auth.getClaims();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/auth/:path*",
    "/api/staff/:path*",
    // The needs-human bell's poll (ticket 79): the one authenticated route
    // outside /api/staff, so staff idling on a page with no other requests
    // still refresh their session cookie on each poll instead of letting it
    // expire under the bell.
    "/api/v1/needs-human",
    "/widget/frame",
  ],
};
