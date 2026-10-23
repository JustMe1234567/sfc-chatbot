import { NextResponse } from "next/server";
import { requireStaff, sameOriginGuard } from "@/api/staff";
import { STAFF_ROLES } from "@/auth/server";
import { retryNotificationById } from "@/mail/notifications";
import { mintReturnLink } from "@/mail/visitorReturn";
import { getChatbotService } from "@/db/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Staff retry of a failed alert. Never duplicates a success; a visitor-return
 * retry mints a fresh single-use link so the re-sent email is never stale.
 */
export async function POST(request: Request, context: RouteContext) {
  const blocked = sameOriginGuard(request);
  if (blocked) {
    return blocked;
  }
  const guard = await requireStaff(request.headers, { roles: STAFF_ROLES });
  if ("response" in guard) {
    return guard.response;
  }

  const { id } = await context.params;
  const { store, db, mail } = await getChatbotService();
  const result = await retryNotificationById(db, mail, id, (conversationId) =>
    mintReturnLink(store, conversationId),
  );
  if (result === "not_found") {
    return NextResponse.json(
      { error: { code: "not_found", message: "Notification not found." } },
      { status: 404 },
    );
  }
  if (result === "already_sent") {
    return NextResponse.json(
      { error: { code: "already_sent", message: "This alert was already delivered." } },
      { status: 409 },
    );
  }
  return NextResponse.json(result);
}
