import { NextResponse } from "next/server";
import { requireStaff, sameOriginGuard } from "@/api/staff";
import { STAFF_ROLES } from "@/auth/server";
import { getChatbotService } from "@/db/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Completes the conversation's open email or phone contact request
 * (ticket 69): the staff member reached the visitor outside the chat. The
 * request row carries who completed it and when; nothing is added to the
 * visitor's transcript and the conversation is not closed — the bot simply
 * stays available. Owners and staff may mark requests contacted; editors
 * cannot. Chat requests are completed by Take over, not here.
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
  const service = await getChatbotService();
  const { store } = service;

  const open = await store.getOpenContactRequest(id);
  if (!open) {
    return NextResponse.json(
      { error: { code: "no_open_request", message: "This conversation has no open contact request." } },
      { status: 409 },
    );
  }
  if (open.medium === "chat") {
    // A chat request is the waiting-for-staff state itself: Take over
    // completes it, and marking it contacted would strand the lock.
    return NextResponse.json(
      {
        error: {
          code: "invalid_medium",
          message: "Take over the conversation to complete a chat request.",
        },
      },
      { status: 409 },
    );
  }
  const completed = await store.completeOpenContactRequest(
    id,
    guard.staff.userId,
    new Date().toISOString(),
  );
  if (!completed) {
    return NextResponse.json(
      { error: { code: "no_open_request", message: "This conversation has no open contact request." } },
      { status: 409 },
    );
  }
  return NextResponse.json({ request: completed });
}
