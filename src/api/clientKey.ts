/**
 * Per-client key for public-endpoint rate limiting (ticket 20). Lives in its
 * own leaf module so the auth provider's sign-in path (ticket 81's login
 * logging) can derive the same client identity without importing the
 * visitor route helpers, which reach the service singleton.
 *
 * In production the key comes only from platform-set headers, on the
 * assumption documented in Vercel's request-header reference: the Vercel
 * edge overwrites x-forwarded-for and does not forward external IPs, and
 * x-vercel-forwarded-for carries that same platform-computed value even when
 * another proxy sits on top of Vercel (x-real-ip matches it there too, and
 * is the conventional trusted header on other reverse proxies). The
 * client-controllable leftmost x-forwarded-for entry is never trusted in
 * production — a caller able to rotate that header must not be able to
 * rotate its rate-limit identity — so a production platform that sets none
 * of the trusted headers leaves every caller in one shared bucket.
 *
 * Local development keeps the pre-platform behavior: the first
 * x-forwarded-for entry acts as the client key (behind a dev proxy that
 * appends), and with no forwarded headers at all every caller shares one
 * bucket.
 */
export function publicClientKey(request: Request): string {
  if (process.env.NODE_ENV === "production") {
    return (
      request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip")?.trim() ||
      "local"
    );
  }
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
