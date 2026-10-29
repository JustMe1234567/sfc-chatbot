import { headers } from "next/headers";
import { requireStaff } from "@/api/staff";
import { STAFF_ROLES } from "@/auth/server";
import DashboardHeader from "../header";
import { getAnalyticsRetentionDays, getReportingTimeZone } from "@/settings";
import { getChatbotService } from "@/db/service";
import AnalyticsView from "./analytics-view";
import styles from "../dashboard.module.css";

/**
 * The staff analytics page (ticket 17): live visitors, period totals, and
 * the daily table, all served from aggregate queries. The owner configures
 * the reporting zone and retention here; staff see the numbers read-only.
 */
export default async function AnalyticsPage() {
  const staffHeaders = await headers();
  const guard = await requireStaff(staffHeaders, { roles: STAFF_ROLES });
  if ("response" in guard) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>This page requires an authorized staff session.</p>
      </main>
    );
  }

  const { db } = await getChatbotService();
  const settings =
    guard.staff.role === "owner"
      ? {
          reportingTimeZone: await getReportingTimeZone(db),
          retentionDays: await getAnalyticsRetentionDays(db),
        }
      : null;

  return (
    <main className={styles.shell}>
      <DashboardHeader
        area="analytics"
        title="Analytics"
        name={guard.staff.name}
        role={guard.staff.role}
      />
      <AnalyticsView role={guard.staff.role} settings={settings} />
    </main>
  );
}
