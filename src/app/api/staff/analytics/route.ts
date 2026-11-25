import { NextResponse } from "next/server";
import { requireStaff } from "@/api/staff";
import { getAnalyticsRetentionDays, getReportingTimeZone } from "@/settings";
import { buildAnalyticsReport, ANALYTICS_PERIOD_DAY_COUNT, type AnalyticsPeriod } from "@/domain/analytics";
import { getChatbotService } from "@/db/service";

/**
 * The analytics report (ticket 17): period totals, the live snapshot, and
 * the daily table — all computed on the server from aggregate queries, so no
 * transcript content and no visitor identifier ever reaches the browser.
 * Admin-only since ticket 102: Admissions Advisors have no Analytics.
 */
export async function GET(request: Request) {
  const guard = await requireStaff(request.headers, { roles: ["admin"] });
  if ("response" in guard) {
    return guard.response;
  }
  const periodParam = new URL(request.url).searchParams.get("period") ?? "7d";
  // Object.hasOwn, not `in`: inherited keys like "constructor" must not pass.
  if (!Object.hasOwn(ANALYTICS_PERIOD_DAY_COUNT, periodParam)) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_period",
          message: "The period must be today, 7d, or 30d.",
        },
      },
      { status: 400 },
    );
  }
  const period = periodParam as AnalyticsPeriod;

  const { store, db } = await getChatbotService();
  const report = await buildAnalyticsReport(store, {
    timeZone: await getReportingTimeZone(db),
    retentionDays: await getAnalyticsRetentionDays(db),
    period,
    now: new Date(),
  });
  return NextResponse.json(report);
}
