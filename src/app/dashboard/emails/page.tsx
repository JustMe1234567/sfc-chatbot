import { headers } from "next/headers";
import Link from "next/link";
import { requireStaff } from "@/api/staff";
import { STAFF_ROLES } from "@/auth/server";
import DashboardHeader from "../header";
import { DESK_STATE_LABELS } from "@/domain/inbox";
import { getChatbotService } from "@/db/service";
import { EMAILS_PAGE_SIZE, emailsPageLinks, resolveEmailsPage } from "./pagination";
import styles from "../dashboard.module.css";
import type { Metadata } from "next";

/** Route-specific document title (ticket 29). */
export const metadata: Metadata = { title: "Email alerts" };


/** Row chips share the desk's state family (ticket 12). */
const STATE_CHIPS: Record<string, string | undefined> = {
  bot_active: styles.chipBot,
  awaiting_staff: styles.chipWaiting,
  claimed: styles.chipClaimed,
  closed: styles.chipClosed,
};

/**
 * The Visitor emails list (ticket 53): every conversation that carries a
 * visitor email — required on every new chat since the contact gate (ticket
 * 66) — derived live from `conversations.visitor_email`. No copied rows, so
 * retention and deletion remove entries with their conversations. Owners and
 * staff, the roles that work handoffs; each row is one link to the
 * conversation itself.
 */
export default async function VisitorEmailsPage({
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

  const { store } = await getChatbotService();
  // The pager's total is one aggregate count; the rows are the page slice
  // only (ticket 50's shape). The email column holds the address the
  // visitor submitted at the contact gate (ticket 66).
  const total = await store.countConversationsWithEmail();
  const { page, totalPages } = resolveEmailsPage((await searchParams).page, total);
  const conversations = await store.listConversationsWithEmail(page, EMAILS_PAGE_SIZE);
  const pageHref = (target: number) => `/dashboard/emails?page=${target}`;

  return (
    <main className={styles.shell}>
      <DashboardHeader
        area="emails"
        title="Visitor emails"
        name={guard.staff.name}
        role={guard.staff.role}
      />

      <div id="sfc-content" className={styles.contentArea} tabIndex={-1}>
        <div className={styles.alertsPage}>
          <section className={styles.alertsSection} aria-labelledby="emails-title">
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>Follow-up contacts</p>
                <h2 id="emails-title">Visitor emails</h2>
                <p>
                  Every new chat starts with the visitor&apos;s name, email
                  address, and phone number, captured before the first message.
                  Each entry opens the conversation it came from; addresses
                  disappear when their conversation is removed by retention or
                  deletion.
                </p>
              </div>
            </div>

            {total === 0 ? (
              <div className={styles.alertEmpty}>
                <strong>No visitor emails yet</strong>
                <p>
                  An entry appears here once a visitor shares their contact
                  details and starts a chat.
                </p>
              </div>
            ) : (
              <>
                <ol className={styles.emailList}>
                  {conversations.map((conversation) => (
                    <li key={conversation.id}>
                      {/* The whole row is the link to the conversation — plain
                          text inside, no nested interactive elements. */}
                      <Link
                        className={styles.emailRow}
                        href={`/dashboard/inbox/${conversation.id}`}
                      >
                        <span className={styles.emailRowMain}>
                          <span className={styles.emailAddress}>{conversation.visitorEmail}</span>
                          <span className={styles.emailRowMeta}>
                            <span
                              className={`${styles.chip} ${STATE_CHIPS[conversation.state] ?? styles.chipClosed}`}
                            >
                              {DESK_STATE_LABELS[conversation.state] ?? conversation.state}
                            </span>
                            <time dateTime={conversation.lastActivityAt}>
                              {new Date(conversation.lastActivityAt).toLocaleString("en-GB")}
                            </time>
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
                {totalPages > 1 ? (
                  <nav className={styles.pager} aria-label="Visitor emails pages">
                    {page > 1 ? (
                      <Link className={styles.pagerLink} href={pageHref(page - 1)}>
                        ← Previous
                      </Link>
                    ) : null}
                    {emailsPageLinks(page, totalPages).map((link, index) =>
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
