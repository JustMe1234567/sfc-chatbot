import { NextResponse } from "next/server";
import { requireStaff, sameOriginGuard } from "@/api/staff";
import { STAFF_ROLES } from "@/auth/server";
import { retryNotificationById } from "@/mail/notifications";
import { getChatbotService } from "@/db/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Staff retry of a failed alert. Never duplicates a success. Visitor-return
 * notifications are retired (ticket 66): no new return link is minted or
 * mailed, so their legacy failed rows answer with a clear refusal instead.
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
  const { db, mail } = await getChatbotService();
  const result = await retryNotificationById(db, mail, id);
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
  if (result === "visitor_return_retired") {
    return NextResponse.json(
      {
        error: {
          code: "visitor_return_retired",
          message: "Visitor return links are no longer sent.",
        },
      },
      { status: 409 },
    );
  }
  return NextResponse.json(result);
}
