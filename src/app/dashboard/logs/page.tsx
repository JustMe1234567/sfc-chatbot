import { headers } from "next/headers";
import { requireStaff } from "@/api/staff";
import DashboardHeader from "../header";
import LogsWorkspace from "./logs-workspace";
import styles from "../dashboard.module.css";
import type { Metadata } from "next";

/** Route-specific document title (ticket 29). */
export const metadata: Metadata = { title: "Logs" };

/**
 * The admin-only Logs tab (ticket 81): every dashboard sign-in attempt, the
 * suspicious subset, and the deletion controls. The admin gate is doubled —
 * the page refuses non-admins and every API request behind the workspace is
 * refused the same way — mirroring the other security-sensitive surfaces.
 */
export default async function LogsPage() {
  const staffHeaders = await headers();
  const guard = await requireStaff(staffHeaders, { roles: ["admin"] });
  if ("response" in guard) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>This page requires the admin role.</p>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <DashboardHeader area="logs" title="Logs" name={guard.staff.name} role={guard.staff.role} />
      <div id="sfc-content" className={styles.contentArea} tabIndex={-1}>
        <LogsWorkspace />
      </div>
    </main>
  );
}
