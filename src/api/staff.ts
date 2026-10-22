import { NextResponse } from "next/server";
import { getChatbotService } from "@/db/service";
import { trustedOrigins } from "@/config";
import { DASHBOARD_ROLES, type StaffRole } from "@/auth/server";

const GENERIC_AUTH_ERROR = { error: { code: "unauthorized", message: "Sign in required." } };

export interface StaffContext {
  userId: string;
  email: string;
  name: string;
  role: StaffRole;
}

/**
 * Resolves the current staff context from the session cookie on every
 * dashboard and staff API request: a valid server-side session, an email
 * verified account, an active (not banned) account, the second factor
 * enabled, and an allowed role. Any failure returns a Response the caller
 * should send unchanged. Route handlers pass request.headers; server
 * components pass (await headers()).
 */
export async function requireStaff(
  requestHeaders: Headers,
  options?: { roles?: readonly string[] },
): Promise<{ staff: StaffContext } | { response: NextResponse }> {
  const { auth } = await getChatbotService();
  const session = await auth.api.getSession({ headers: requestHeaders }).catch(() => null);

  if (!session) {
    return { response: NextResponse.json(GENERIC_AUTH_ERROR, { status: 401 }) };
  }
  const user = session.user as Record<string, unknown>;
  if (user.emailVerified !== true) {
    return {
      response: NextResponse.json(GENERIC_AUTH_ERROR, { status: 403 }),
    };
  }
  if (user.banned === true) {
    return {
      response: NextResponse.json(GENERIC_AUTH_ERROR, { status: 401 }),
    };
  }
  if (user.twoFactorEnabled !== true) {
    return {
      response: NextResponse.json(
        { error: { code: "two_factor_enrollment_required", message: "Enroll a second factor to continue." } },
        { status: 403 },
      ),
    };
  }
  const role = typeof user.role === "string" ? user.role : "";
  const allowed = options?.roles ?? DASHBOARD_ROLES;
  if (!allowed.includes(role as StaffRole)) {
    return {
      response: NextResponse.json(GENERIC_AUTH_ERROR, { status: 403 }),
    };
  }
  return {
    staff: {
      userId: String(user.id),
      email: String(user.email),
      name: String(user.name),
      role: role as StaffRole,
    },
  };
}

/**
 * CSRF protection for cookie-authenticated state-changing staff requests:
 * unsafe methods must carry an Origin header the app itself trusts. Used by
 * staff mutation routes as they arrive (claiming, replying in ticket 04).
 */
export function sameOriginGuard(request: Request): NextResponse | null {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    return null;
  }
  const origin = request.headers.get("origin");
  if (origin && trustedOrigins().includes(origin)) {
    return null;
  }
  return NextResponse.json(
    { error: { code: "cross_origin_blocked", message: "Request origin is not allowed." } },
    { status: 403 },
  );
}
