import { NextResponse } from "next/server";
import { requireStaff, sameOriginGuard } from "@/api/staff";
import {
  getAnalyticsRetentionDays,
  getReportingTimeZone,
  isValidRetentionDays,
  isValidTimeZoneName,
  setAnalyticsRetentionDays,
  setReportingTimeZone,
} from "@/settings";
import { expireAnalytics } from "@/domain/analytics";
import { getChatbotService } from "@/db/service";

/**
 * The owner's analytics configuration (ticket 17): the reporting time zone
 * day boundaries are drawn in, and how many days of analytics rows are kept
 * before expiry removes them. Unlike transcript retention there is no
 * unconfigured state — analytics always reports in some zone and always
 * expires, so the PUT requires both values. Saving runs the expiry
 * immediately so a shortened period takes effect at once.
 */
export async function GET(request: Request) {
  const guard = await requireStaff(request.headers, { roles: ["owner"] });
  if ("response" in guard) {
    return guard.response;
  }
  const { db } = await getChatbotService();
  return NextResponse.json({
    reportingTimeZone: getReportingTimeZone(db),
    retentionDays: getAnalyticsRetentionDays(db),
  });
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
  const body = (await request.json().catch(() => null)) as {
    reportingTimeZone?: unknown;
    retentionDays?: unknown;
  } | null;
  if (
    body === null ||
    !isValidTimeZoneName(body.reportingTimeZone) ||
    !isValidRetentionDays(body.retentionDays)
  ) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_analytics_settings",
          message:
            "Provide a valid IANA time zone and a whole number of days between 1 and 3650.",
        },
      },
      { status: 400 },
    );
  }

  const { db, store } = await getChatbotService();
  setReportingTimeZone(db, body.reportingTimeZone);
  setAnalyticsRetentionDays(db, body.retentionDays);
  const removed = await expireAnalytics(db, store);
  return NextResponse.json({
    reportingTimeZone: getReportingTimeZone(db),
    retentionDays: body.retentionDays,
    removed,
  });
}
