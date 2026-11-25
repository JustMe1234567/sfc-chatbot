import { NextResponse } from "next/server";
import { requireStaff, sameOriginGuard } from "@/api/staff";
import {
  getSupportHours,
  isValidSupportHours,
  setSupportHours,
} from "@/settings";
import { getChatbotService } from "@/db/service";

/**
 * The owner's support-hours configuration (ticket 09): when the desk is
 * staffed, in the college's own time zone. Every escalation composes its
 * handoff wording from this setting at reply time, so a save changes what
 * visitors see on the next handoff with no redeploy. `hours: null` clears
 * the configuration back to the promise-free general message.
 */
export async function GET(request: Request) {
  const guard = await requireStaff(request.headers, { roles: ["admin"] });
  if ("response" in guard) {
    return guard.response;
  }
  const { db } = await getChatbotService();
  return NextResponse.json({ hours: await getSupportHours(db) });
}

export async function PUT(request: Request) {
  const blocked = sameOriginGuard(request);
  if (blocked) {
    return blocked;
  }
  const guard = await requireStaff(request.headers, { roles: ["admin"] });
  if ("response" in guard) {
    return guard.response;
  }
  const body = (await request.json().catch(() => null)) as { hours?: unknown } | null;
  if (body === null || !("hours" in body)) {
    return NextResponse.json(
      { error: { code: "invalid_hours", message: "Provide the hours configuration, or null to clear it." } },
      { status: 400 },
    );
  }
  if (body.hours !== null && !isValidSupportHours(body.hours)) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_hours",
          message:
            "Provide a valid IANA time zone, 1–7 distinct open days (0–6), and a start/end time of day with the end after the start.",
        },
      },
      { status: 400 },
    );
  }

  const { db } = await getChatbotService();
  await setSupportHours(db, body.hours);
  return NextResponse.json({ hours: body.hours });
}
