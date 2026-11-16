import { NextResponse } from "next/server";
import { requireStaff, sameOriginGuard } from "@/api/staff";
import { getChatbotService } from "@/db/service";

/**
 * Signs the calling staff member out of every device by revoking all their
 * sessions, including the current one. Cookie-authenticated and
 * state-changing: guarded by the same-origin CSRF check.
 */
export async function POST(request: Request) {
  const blocked = sameOriginGuard(request);
  if (blocked) {
    return blocked;
  }
  const guard = await requireStaff(request.headers);
  if ("response" in guard) {
    return guard.response;
  }

  const { auth } = await getChatbotService();
  await auth.revokeAll(guard.staff.authUserId);
  return NextResponse.json({ status: true });
}
