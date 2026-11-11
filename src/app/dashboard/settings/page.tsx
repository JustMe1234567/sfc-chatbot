import { headers } from "next/headers";
import { requireStaff } from "@/api/staff";
import { DASHBOARD_ROLES } from "@/auth/server";
import DashboardHeader from "../header";
import {
  getChatbotIconVersion,
  getChatheadConfig,
  getDashboardFaviconVersion,
} from "@/settings";
import { getChatbotService } from "@/db/service";
import { chatheadForeground } from "@/domain/branding";
import BrandingSettings from "./branding-settings";
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

  const { db } = await getChatbotService();
  const [iconVersion, faviconVersion, chathead] = await Promise.all([
    getChatbotIconVersion(db),
    getDashboardFaviconVersion(db),
    getChatheadConfig(db),
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
