import { headers } from "next/headers";
import { requireStaff } from "@/api/staff";
import DashboardHeader from "../header";
import { getAnalyticsRetentionDays, getReportingTimeZone } from "@/settings";
import { getChatbotService } from "@/db/service";
import AnalyticsView from "./analytics-view";
import styles from "../dashboard.module.css";
import type { Metadata } from "next";

/** Route-specific document title (ticket 29). */
export const metadata: Metadata = { title: "Analytics" };


/**
 * The analytics page (ticket 17): live visitors, period totals, and the
 * daily table, all served from aggregate queries, with the reporting-zone
 * and retention settings on the same page. Admin-only since ticket 102 —
 * Admissions Advisors have no Analytics.
 */
export default async function AnalyticsPage() {
  const staffHeaders = await headers();
  const guard = await requireStaff(staffHeaders, { roles: ["admin"] });
  if ("response" in guard) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>This page requires the admin role.</p>
      </main>
    );
  }

  const { db } = await getChatbotService();
  const settings = {
    reportingTimeZone: await getReportingTimeZone(db),
    retentionDays: await getAnalyticsRetentionDays(db),
  };

  return (
    <main className={styles.shell}>
      <DashboardHeader
        area="analytics"
        title="Analytics"
        name={guard.staff.name}
        role={guard.staff.role}
      />
      <div id="sfc-content" className={styles.contentArea} tabIndex={-1}>
        <AnalyticsView settings={settings} />
      </div>
    </main>
  );
}
