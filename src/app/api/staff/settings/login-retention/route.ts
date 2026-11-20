import { NextResponse } from "next/server";
import { requireStaff, sameOriginGuard } from "@/api/staff";
import {
  DEFAULT_LOGIN_RETENTION_DAYS,
  getLoginRetentionDays,
  isValidRetentionDays,
  setLoginRetentionDays,
} from "@/settings";
import { sweepLoginEvents } from "@/domain/loginLog";
import { getChatbotService } from "@/db/service";

/**
 * The owner's login retention period (ticket 81): how many days of login
 * events the daily maintenance pass keeps. While no period is configured,
 * the 90-day default applies; null resets to it. Saving runs the sweep
 * immediately so a newly set (or shortened) period takes effect without
 * waiting for the next pass.
 */
export async function GET(request: Request) {
  const guard = await requireStaff(request.headers, { roles: ["owner"] });
  if ("response" in guard) {
    return guard.response;
  }
  const { db } = await getChatbotService();
  return NextResponse.json({ days: await getLoginRetentionDays(db) });
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
      {
        error: {
          code: "invalid_retention",
          message: `Provide the retention period in days, or null to reset to the ${DEFAULT_LOGIN_RETENTION_DAYS}-day default.`,
        },
      },
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

  const { db } = await getChatbotService();
  await setLoginRetentionDays(db, body.days);
  const swept = await sweepLoginEvents(db);
  return NextResponse.json({
    days: body.days,
    removed: swept ?? 0,
  });
}
