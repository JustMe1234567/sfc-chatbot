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

  const { db } = await getChatbotService();
  await db.run('DELETE FROM "session" WHERE "userId" = ?', guard.staff.userId);
  return NextResponse.json({ status: true });
}
