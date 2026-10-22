import { NextResponse } from "next/server";
import { requireStaff } from "@/api/staff";
import { STAFF_ROLES } from "@/auth/server";
import { listNotifications } from "@/mail/notifications";
import { getChatbotService } from "@/db/service";

/** Delivery status of staff alerts, visible to authorized staff. */
export async function GET(request: Request) {
  const guard = await requireStaff(request.headers, { roles: STAFF_ROLES });
  if ("response" in guard) {
    return guard.response;
  }

  const { db } = await getChatbotService();
  const notifications = await listNotifications(db);
  return NextResponse.json({ notifications });
}
