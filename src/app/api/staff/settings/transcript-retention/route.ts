import { NextResponse } from "next/server";
import { requireStaff, sameOriginGuard } from "@/api/staff";
import {
  DEFAULT_RETENTION_DAYS,
  getTranscriptRetentionDays,
  isValidRetentionDays,
  setTranscriptRetentionDays,
} from "@/settings";
import { sweepTranscripts } from "@/domain/retention";
import { getChatbotService } from "@/db/service";

/**
 * The owner's transcript retention period (ticket 10, amended by ticket 47):
 * how many days a closed conversation's transcript and visitor contact
 * details are kept before the automated cleanup removes them. While no
 * period is configured, the 30-day default applies; null resets to it.
 * Saving runs the cleanup immediately so a newly set (or shortened) period
 * takes effect without waiting for staff traffic.
 */
export async function GET(request: Request) {
  const guard = await requireStaff(request.headers, { roles: ["owner"] });
  if ("response" in guard) {
    return guard.response;
  }
  const { db } = await getChatbotService();
  return NextResponse.json({ days: await getTranscriptRetentionDays(db) });
}

export async function PUT(request: Request) {
  const blocked = sameOriginGuard(request);
  if (blocked) {
    return blocked;
  }
  const guard = await requireStaff(request.headers, { roles: ["owner"] });
  if ("response" in guard) {
    return guard.response;
  }
  const body = (await request.json().catch(() => null)) as { days?: unknown } | null;
  if (body === null || !("days" in body)) {
    return NextResponse.json(
        { error: { code: "invalid_retention", message: `Provide the retention period in days, or null to reset to the ${DEFAULT_RETENTION_DAYS}-day default.` } },
      { status: 400 },
    );
  }
  if (body.days !== null && !isValidRetentionDays(body.days)) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_retention",
          message: "The retention period must be a whole number of days between 1 and 3650.",
        },
      },
      { status: 400 },
    );
  }

  const { db, store } = await getChatbotService();
  await setTranscriptRetentionDays(db, body.days);
  const swept = await sweepTranscripts(db, store);
  return NextResponse.json({
    days: body.days,
    removed: swept ? swept.removedConversations : 0,
  });
}
