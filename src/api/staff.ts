import { NextResponse } from "next/server";
import { getChatbotService } from "@/db/service";
import { trustedOrigins } from "@/config";
import { DASHBOARD_ROLES, type StaffRole } from "@/auth/server";

const GENERIC_AUTH_ERROR = { error: { code: "unauthorized", message: "Sign in required." } };
const CROSS_ORIGIN_BLOCKED = {
  error: { code: "cross_origin_blocked", message: "Request origin is not allowed." },
};

export interface StaffContext {
  userId: string;
  authUserId: string;
  username: string;
  name: string;
  role: StaffRole;
}

/**
 * Resolves the current staff context from the session cookie on every
 * dashboard and staff API request: a valid server-side session, a verified
 * account, an active (not banned) account, the second factor
 * enabled, and an allowed role. Any failure returns a Response the caller
 * should send unchanged. Route handlers pass request.headers; server
 * components pass (await headers()).
 */
export async function requireStaff(
  requestHeaders: Headers,
  options?: { roles?: readonly string[] },
): Promise<{ staff: StaffContext } | { response: NextResponse }> {
  const { auth, db } = await getChatbotService();
  const identity = await auth.authenticate(requestHeaders).catch(() => null);

  if (!identity) {
    return { response: NextResponse.json(GENERIC_AUTH_ERROR, { status: 401 }) };
  }
  if (!identity.emailVerified) {
    return {
      response: NextResponse.json(GENERIC_AUTH_ERROR, { status: 403 }),
    };
  }
  const user = await db.get<{
    id: string;
    name: string;
    username: string;
    role: string;
    banned: unknown;
    emailVerified: unknown;
    twoFactorEnabled: unknown;
  }>(
    `SELECT "id", "name", "username", "role", "banned", "emailVerified", "twoFactorEnabled"
     FROM staff_members WHERE "supabaseUserId" = ?`,
    identity.userId,
  );
  if (!user || user.banned === true || user.banned === 1 || user.banned === "1") {
    return {
      response: NextResponse.json(GENERIC_AUTH_ERROR, { status: 401 }),
    };
  }
  const staffEmailVerified =
    user.emailVerified === true || user.emailVerified === 1 || user.emailVerified === "1";
  if (!staffEmailVerified) {
    return { response: NextResponse.json(GENERIC_AUTH_ERROR, { status: 403 }) };
  }
  const staffMfa =
    user.twoFactorEnabled === true || user.twoFactorEnabled === 1 || user.twoFactorEnabled === "1";
  if (!identity.mfaEnrolled || !staffMfa) {
    return {
      response: NextResponse.json(
        { error: { code: "two_factor_enrollment_required", message: "Enroll a second factor to continue." } },
        { status: 403 },
      ),
    };
  }
  if (identity.aal !== "aal2") {
    return {
      response: NextResponse.json(
        { error: { code: "two_factor_challenge_required", message: "Verify your authenticator to continue." } },
        { status: 403 },
      ),
    };
  }
  const role = user.role;
  const allowed = options?.roles ?? DASHBOARD_ROLES;
  if (!allowed.includes(role as StaffRole)) {
    return {
      response: NextResponse.json(GENERIC_AUTH_ERROR, { status: 403 }),
    };
  }
  return {
    staff: {
      userId: String(user.id),
      authUserId: identity.userId,
      username: user.username,
      name: user.name,
      role: role as StaffRole,
    },
  };
}

/**
 * CSRF protection for cookie-authenticated state-changing staff requests:
 * unsafe methods must carry an Origin header the app itself trusts, or —
 * when Origin is absent (old browsers, some proxies strip it) — a Referer
 * whose origin the app trusts (ticket 30). Both headers are set by the
 * browser, so cross-site script can forge neither; an unsafe method
 * carrying neither header is rejected. Used by staff mutation routes as
 * they arrive (claiming, replying in ticket 04).
 */
export function sameOriginGuard(request: Request): NextResponse | null {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    return null;
  }
  const trusted = trustedOrigins();
  const origin = request.headers.get("origin");
  if (origin) {
    if (trusted.includes(origin)) {
      return null;
    }
    return NextResponse.json(CROSS_ORIGIN_BLOCKED, { status: 403 });
  }
  // No Origin header: the Referer's origin is the remaining browser-set
  // signal. Unparseable or untrusted — or no Referer at all — is refused.
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      if (trusted.includes(new URL(referer).origin)) {
        return null;
      }
    } catch {
      // A malformed Referer is not a signal to trust.
    }
  }
  return NextResponse.json(CROSS_ORIGIN_BLOCKED, { status: 403 });
}
