import { NextResponse } from "next/server";
import { getChatbotService } from "@/db/service";
import { requireStaff } from "@/api/staff";
import { STAFF_ROLES } from "@/auth/server";
import { summarizeConversationDesk } from "@/domain/inbox";
import { withJsonErrors } from "@/api/serverError";

/**
 * Whether any live desk conversation sits in Needs human (ticket 79): the
 * one-bit signal the dashboard sidebar's Conversations bell polls, correct
 * from every dashboard page — the sidebar carries no desk data outside the
 * inbox, so even presence needs one lightweight request. The boolean comes
 * from the same desk read model the notification sound's buzzer alarms on
 * (ticket 77's `desk.incoming`), so the bell and the alarm can never drift
 * apart. Staff-only like the other staff routes; editors have no
 * Conversations row and never call this.
 */
async function getHandler(request: Request) {
  const guard = await requireStaff(request.headers, { roles: STAFF_ROLES });
  if ("response" in guard) {
    return guard.response;
  }
  const { store } = await getChatbotService();
  const { incoming } = await summarizeConversationDesk(store);
  return NextResponse.json({ needsHuman: incoming.length > 0 });
}

export const GET = withJsonErrors(getHandler);
