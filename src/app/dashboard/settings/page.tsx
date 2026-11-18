import { headers } from "next/headers";
import { requireStaff } from "@/api/staff";
import { DASHBOARD_ROLES } from "@/auth/server";
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
import PasswordSettings from "./password-settings";
import SupportHoursForm from "../notifications/support-hours-form";
import RetentionForm from "../notifications/retention-form";
import { getSupportHours, getLoginRetentionDays, getTranscriptRetentionDays } from "@/settings";
import { latestRetentionRun } from "@/domain/retention";
import styles from "../dashboard.module.css";
import type { Metadata } from "next";

/** Route-specific document title (ticket 29). */
export const metadata: Metadata = { title: "Settings" };

/**
 * The branding settings page (ticket 70): every dashboard role can configure
 * the chatbot icon, the dashboard favicon, and the chathead appearance. The
 * page server-reads the effective values (versions included) so the forms
 * render what is live right now.
 */
export default async function SettingsPage() {
  const staffHeaders = await headers();
  const guard = await requireStaff(staffHeaders, { roles: DASHBOARD_ROLES });
  if ("response" in guard) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>This page requires an authorized staff session.</p>
      </main>
    );
  }

  const { db, store } = await getChatbotService();
  const [
    iconVersion,
    faviconVersion,
    chathead,
    supportHours,
    retentionDays,
    lastRun,
    embedOrigins,
    loginRetentionDays,
  ] = await Promise.all([
    getChatbotIconVersion(db),
    getDashboardFaviconVersion(db),
    getChatheadConfig(db),
    getSupportHours(db),
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
        <PasswordSettings />
        {guard.staff.role === "owner" ? (
          <>
            <div className={styles.alertSettingsGrid}>
              <SupportHoursForm initialHours={supportHours} />
              <RetentionForm initialDays={retentionDays} lastRun={lastRun} />
              {/* Login retention (ticket 81): how long sign-in attempts
                  live in the owner-only Logs tab. */}
              <LoginRetentionForm initialDays={loginRetentionDays} />
            </div>
            {/* Security-sensitive owner configuration (ticket 76): which
                websites may host the widget. Staff and editors never see
                the card and their API requests are refused. */}
            <EmbedAllowlistSettings initialOrigins={embedOrigins} />
          </>
        ) : null}
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
