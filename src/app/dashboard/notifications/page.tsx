import { headers } from "next/headers";
import Link from "next/link";
import { requireStaff } from "@/api/staff";
import { STAFF_ROLES } from "@/auth/server";
import { listNotifications } from "@/mail/notifications";
import { getAlertRecipients } from "@/settings";
import { getChatbotService } from "@/db/service";
import AlertSettingsForm from "./alert-settings-form";
import RetryButton from "./retry-button";
import styles from "../dashboard.module.css";

export default async function NotificationsPage() {
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
  const notifications = await listNotifications(db);
  const recipients = getAlertRecipients(db);

  return (
    <main className={styles.shell}>
      <header className={styles.shellHeader}>
        <h1>Email alerts</h1>
        <Link href="/dashboard/inbox">Back to inbox</Link>
      </header>

      {guard.staff.role === "owner" ? (
        <AlertSettingsForm initialRecipients={recipients} />
      ) : (
        <p className={styles.hint}>
          Alerts currently go to: {recipients.length > 0 ? recipients.join(", ") : "not configured"}
        </p>
      )}

      <div className={styles.inbox}>
        {notifications.length === 0 ? (
          <p className={styles.empty}>No alerts have been sent yet.</p>
        ) : (
          notifications.map((notification) => (
            <div key={notification.id} className={styles.conversationCard}>
              <div className={styles.meta}>
                {notification.status === "sent"
                  ? "Delivered"
                  : notification.status === "failed"
                    ? "Failed"
                    : "Pending"}
                {" · "}
                attempt {notification.attempts}
                {" · "}
                {new Date(notification.createdAt).toLocaleString("en-GB")}
              </div>
              <div className={styles.preview}>
                {notification.lastError ? (
                  <>
                    {notification.lastError}
                    {notification.status !== "sent" && (
                      <RetryButton notificationId={notification.id} />
                    )}
                  </>
                ) : (
                  <>Alert for a visitor conversation, sent to {notification.recipients.join(", ")}.</>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
