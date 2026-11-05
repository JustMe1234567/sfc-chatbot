import { headers } from "next/headers";
import Link from "next/link";
import { requireStaff } from "@/api/staff";
import { STAFF_ROLES } from "@/auth/server";
import DashboardHeader from "../header";
import {
  listNotificationPage,
  notificationStatusCounts,
} from "@/mail/notifications";
import {
  notificationPageLinks,
  resolveNotificationPage,
} from "./pagination";
import {
  DEFAULT_RETENTION_DAYS,
  getAlertRecipients,
  getSupportHours,
  getTranscriptRetentionDays,
} from "@/settings";
import { scheduleSummary } from "@/domain/hours";
import { latestRetentionRun } from "@/domain/retention";
import { getChatbotService } from "@/db/service";
import AlertSettingsForm from "./alert-settings-form";
import SupportHoursForm from "./support-hours-form";
import RetentionForm from "./retention-form";
import RetryButton from "./retry-button";
import styles from "../dashboard.module.css";

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staffHeaders = await headers();
  const guard = await requireStaff(staffHeaders, { roles: STAFF_ROLES });
  if ("response" in guard) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>This page requires an authorized staff session.</p>
      </main>
    );
  }

  const { db, store } = await getChatbotService();
  const recipients = await getAlertRecipients(db);
  const supportHours = await getSupportHours(db);
  const retentionDays = await getTranscriptRetentionDays(db);
  const lastRun = await latestRetentionRun(store);
  // The badges and pager both key on counts over EVERY notification; only
  // the rendered rows come from the page query (ticket 50).
  const counts = await notificationStatusCounts(db);
  const { page, totalPages } = resolveNotificationPage((await searchParams).page, counts.total);
  const notifications = await listNotificationPage(db, page);
  const deliveredCount = counts.delivered;
  const failedCount = counts.failed;
  const pageHref = (target: number) => `/dashboard/notifications?page=${target}`;

  return (
    <main className={styles.shell}>
      <DashboardHeader
        area="alerts"
        title="Email alerts"
        name={guard.staff.name}
        role={guard.staff.role}
      />

      <div className={styles.contentArea}>
        <div className={styles.alertsPage}>
          <section className={styles.alertsSection} aria-labelledby="delivery-settings-title">
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>Delivery setup</p>
                <h2 id="delivery-settings-title">How email alerts work</h2>
                <p>
                  Choose who receives handoff alerts, when staff are available, and how long closed
                  transcripts are retained.
                </p>
              </div>
            </div>

            {guard.staff.role === "owner" ? (
              <div className={styles.alertSettingsGrid}>
                <SupportHoursForm initialHours={supportHours} />
                <AlertSettingsForm initialRecipients={recipients} />
                <RetentionForm initialDays={retentionDays} lastRun={lastRun} />
              </div>
            ) : (
              <dl className={styles.alertSummaryGrid}>
                <div>
                  <dt>Support hours</dt>
                  <dd>
                    {supportHours
                      ? scheduleSummary(supportHours)
                      : "Not configured; visitors receive the general follow-up message."}
                  </dd>
                </div>
                <div>
                  <dt>Recipients</dt>
                  <dd>{recipients.length > 0 ? recipients.join(", ") : "Not configured"}</dd>
                </div>
                <div>
                  <dt>Transcript retention</dt>
                  <dd>
                    {retentionDays !== null
                      ? `${retentionDays} days after closure`
                      : `${DEFAULT_RETENTION_DAYS} days after closure (the default)`}
                  </dd>
                </div>
              </dl>
            )}
          </section>

          <section className={styles.alertsSection} aria-labelledby="delivery-history-title">
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>Activity</p>
                <h2 id="delivery-history-title">Delivery history</h2>
                <p>
                  Recent staff-alert attempts, newest first. Delivered means the
                  college&apos;s mail service accepted the message; it cannot
                  confirm the recipient read it.
                </p>
              </div>
              <div className={styles.deliverySummary} aria-label="Delivery totals">
                <span className={`${styles.deliveryCount} ${styles.deliveryCountSent}`}>
                  {deliveredCount} delivered
                </span>
                {failedCount > 0 ? (
                  <span className={`${styles.deliveryCount} ${styles.deliveryCountFailed}`}>
                    {failedCount} failed
                  </span>
                ) : null}
              </div>
            </div>

            {counts.total === 0 ? (
              <div className={styles.alertEmpty}>
                <strong>No email alerts yet</strong>
                <p>New handoff alerts will appear here with their delivery status.</p>
              </div>
            ) : (
              <>
                <ol className={styles.alertList}>
                  {notifications.map((notification) => {
                    const statusLabel =
                      notification.status === "sent"
                        ? "Delivered"
                        : notification.status === "failed"
                          ? "Failed"
                          : "Pending";
                    const statusClass =
                      notification.status === "sent"
                        ? styles.alertStatusSent
                        : notification.status === "failed"
                          ? styles.alertStatusFailed
                          : styles.alertStatusPending;

                    return (
                      <li key={notification.id} className={styles.alertRow}>
                        <div className={styles.alertRowMain}>
                          <div className={styles.alertRowMeta}>
                            <span className={`${styles.alertStatus} ${statusClass}`}>{statusLabel}</span>
                            <span>Attempt {notification.attempts}</span>
                            <time dateTime={notification.createdAt}>
                              {new Date(notification.createdAt).toLocaleString("en-GB")}
                            </time>
                          </div>
                          <p className={styles.alertMessage}>
                            {notification.lastError
                              ? notification.lastError
                              : `Sent to ${notification.recipients.join(", ")}.`}
                          </p>
                        </div>
                        {notification.lastError && notification.status !== "sent" ? (
                          <RetryButton notificationId={notification.id} />
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
                {totalPages > 1 ? (
                  <nav className={styles.pager} aria-label="Delivery history pages">
                    {page > 1 ? (
                      <Link className={styles.pagerLink} href={pageHref(page - 1)}>
                        ← Previous
                      </Link>
                    ) : null}
                    {notificationPageLinks(page, totalPages).map((link, index) =>
                      link.kind === "gap" ? (
                        <span
                          key={`gap-${index}`}
                          className={styles.pagerGap}
                          aria-hidden="true"
                        >
                          …
                        </span>
                      ) : (
                        <Link
                          key={`page-${link.page}`}
                          className={styles.pagerLink}
                          href={pageHref(link.page)}
                          aria-current={link.page === page ? "page" : undefined}
                        >
                          {link.page}
                        </Link>
                      ),
                    )}
                    {page < totalPages ? (
                      <Link className={styles.pagerLink} href={pageHref(page + 1)}>
                        Next →
                      </Link>
                    ) : null}
                  </nav>
                ) : null}
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
