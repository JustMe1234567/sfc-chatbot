import { headers } from "next/headers";
import { requireStaff } from "@/api/staff";
import DashboardHeader from "../header";
import {
  getChatbotIconVersion,
  getChatheadConfig,
  getDashboardFaviconVersion,
  getEmbedAllowlistOrigins,
} from "@/settings";
import { getChatbotService } from "@/db/service";
import { chatheadForeground } from "@/domain/branding";
import BrandingSettings from "./branding-settings";
import EmbedAllowlistSettings from "./embed-allowlist-settings";
import LoginRetentionForm from "./login-retention-form";
import SupportHoursForm from "../notifications/support-hours-form";
import RetentionForm from "../notifications/retention-form";
import { getSupportHours, getLoginRetentionDays, getTranscriptRetentionDays } from "@/settings";
import { latestRetentionRun } from "@/domain/retention";
import styles from "../dashboard.module.css";
import type { Metadata } from "next";

/** Route-specific document title (ticket 29). */
export const metadata: Metadata = { title: "Settings" };

/**
 * The settings page: an Admin area (ticket 102). Admins configure the
 * support hours, transcript retention, login-log retention, and embed
 * allowlist, and — since ticket 70 — the chatbot icon, the dashboard favicon,
 * and the chathead appearance. Admissions Advisors are refused and have no
 * navigation link here; their self-service password change lives in the
 * dashboard chrome, where both roles reach it. The page server-reads the
 * effective values (versions included) so the forms render what is live now.
 */
export default async function SettingsPage() {
  const staffHeaders = await headers();
  const guard = await requireStaff(staffHeaders, { roles: ["admin"] });
  if ("response" in guard) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>This page requires the admin role.</p>
      </main>
    );
  }

  const { db, store } = await getChatbotService();
  // Ticket 89: all eight reads previously raced in one Promise.all, and on a
  // pool without headroom (observed at PG_POOL_MAX=5) the authed render
  // starved — the leases never freed and the navigation timed out. Two
  // sequential groups of four keep the render at half the default pool's
  // eight leases or below; the values and their order are unchanged.
  const [iconVersion, faviconVersion, chathead, supportHours] = await Promise.all([
    getChatbotIconVersion(db),
    getDashboardFaviconVersion(db),
    getChatheadConfig(db),
    getSupportHours(db),
  ]);
  const [retentionDays, lastRun, embedOrigins, loginRetentionDays] = await Promise.all([
    getTranscriptRetentionDays(db),
    latestRetentionRun(store),
    getEmbedAllowlistOrigins(db),
    getLoginRetentionDays(db),
  ]);

  return (
    <main className={styles.shell}>
      <DashboardHeader
        area="settings"
        title="Settings"
        name={guard.staff.name}
        role={guard.staff.role}
      />
      <div id="sfc-content" className={styles.contentArea} tabIndex={-1}>
        <div className={styles.alertSettingsGrid}>
          <SupportHoursForm initialHours={supportHours} />
          <RetentionForm initialDays={retentionDays} lastRun={lastRun} />
          {/* Login retention (ticket 81): how long sign-in attempts live in
              the admin-only Logs tab. */}
          <LoginRetentionForm initialDays={loginRetentionDays} />
        </div>
        {/* Security-sensitive configuration (ticket 76): which websites may
            host the widget. */}
        <EmbedAllowlistSettings initialOrigins={embedOrigins} />
        <BrandingSettings
          initial={{
            chatbotIconUrl: `/api/branding/chatbot-icon?v=${encodeURIComponent(iconVersion)}`,
            faviconUrl: `/api/branding/dashboard-favicon?v=${encodeURIComponent(faviconVersion)}`,
            chathead: {
              backgroundColor: chathead.backgroundColor,
              iconSize: chathead.iconSize,
              padding: chathead.padding,
              width: chathead.width,
              height: chathead.height,
              foreground: chatheadForeground(chathead.backgroundColor),
            },
          }}
        />
      </div>
    </main>
  );
}
