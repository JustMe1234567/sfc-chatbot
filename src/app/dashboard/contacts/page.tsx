import { headers } from "next/headers";
import Link from "next/link";
import { requireStaff } from "@/api/staff";
import { STAFF_ROLES } from "@/auth/server";
import DashboardHeader from "../header";
import { DESK_STATE_LABELS } from "@/domain/inbox";
import type { ConversationState } from "@/domain/types";
import { getChatbotService } from "@/db/service";
import { CONTACTS_PAGE_SIZE, contactsPageLinks, resolveContactsPage } from "./pagination";
import styles from "../dashboard.module.css";
import type { Metadata } from "next";

/** Route-specific document title (ticket 29). */
export const metadata: Metadata = { title: "Visitor contacts" };

/** The saved contact's latest requested medium, as the row shows it. */
const MEDIUM_LABELS: Record<string, string> = {
  chat: "Chat",
  email: "Email",
  phone: "Phone",
};

/** Row chips share the desk's state family (ticket 12). */
const STATE_CHIPS: Record<ConversationState, string | undefined> = {
  bot_active: styles.chipBot,
  awaiting_staff: styles.chipWaiting,
  claimed: styles.chipClaimed,
  closed: styles.chipClosed,
};

/**
 * The Visitor contacts list (ticket 69): conversations whose visitor created
 * at least one contact request — the explicit ask that promotes the
 * temporary chat-start details into the saved contact list. Derived live
 * from the requests table (no copied rows, so retention and deletion remove
 * entries with their conversations); each row shows the visitor's name,
 * email, phone, latest requested medium, and the chat-start time. Owners
 * and staff, the roles that work follow-ups; each row is one link to the
 * conversation itself.
 */
export default async function VisitorContactsPage({
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
  // only (ticket 50's shape).
  const total = await store.countConversationsWithContactRequest();
  const { page, totalPages } = resolveContactsPage((await searchParams).page, total);
  const rows = await store.listConversationsWithContactRequest(page, CONTACTS_PAGE_SIZE);
  const pageHref = (target: number) => `/dashboard/contacts?page=${target}`;

  return (
    <main className={styles.shell}>
      <DashboardHeader
        area="contacts"
        title="Visitor contacts"
        name={guard.staff.name}
        role={guard.staff.role}
      />

      <div id="sfc-content" className={styles.contentArea} tabIndex={-1}>
        <div className={styles.alertsPage}>
          <section className={styles.alertsSection} aria-labelledby="contacts-title">
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>Follow-up contacts</p>
                <h2 id="contacts-title">Visitor contacts</h2>
                <p>
                  Visitors share their name, email address, and phone number to
                  start a chat. Those details become a saved contact — with a
                  contact request our team follows up on — once the visitor asks
                  to be reached by chat, email, or phone. Entries disappear when
                  their conversation is removed by retention or deletion.
                </p>
              </div>
            </div>

            {total === 0 ? (
              <div className={styles.alertEmpty}>
                <strong>No saved contacts yet</strong>
                <p>
                  An entry appears here once a visitor asks for staff help or
                  asks to be contacted by email or phone.
                </p>
              </div>
            ) : (
              <>
                <ol className={styles.emailList}>
                  {rows.map(({ conversation, medium }) => (
                    <li key={conversation.id}>
                      {/* The whole row is the link to the conversation — plain
                          text inside, no nested interactive elements. */}
                      <Link
                        className={styles.emailRow}
                        href={`/dashboard/inbox/${conversation.id}`}
                      >
                        <span className={styles.emailRowMain}>
                          <span className={styles.emailAddress}>
                            {conversation.visitorName ?? "Visitor"}
                          </span>
                          <span className={styles.emailRowMeta}>
                            <span>{conversation.visitorEmail}</span>
                            <span>{conversation.visitorPhone}</span>
                            <span
                              className={`${styles.chip} ${STATE_CHIPS[conversation.state] ?? styles.chipClosed}`}
                            >
                              {MEDIUM_LABELS[medium] ?? medium}
                            </span>
                            {/* The chat-start time (ticket 69): the moment
                                the initial contact form was accepted. */}
                            <time dateTime={conversation.createdAt}>
                              Chat started{" "}
                              {new Date(conversation.createdAt).toLocaleString("en-GB")}
                            </time>
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
                {totalPages > 1 ? (
                  <nav className={styles.pager} aria-label="Visitor contacts pages">
                    {page > 1 ? (
                      <Link className={styles.pagerLink} href={pageHref(page - 1)}>
                        ← Previous
                      </Link>
                    ) : null}
                    {contactsPageLinks(page, totalPages).map((link, index) =>
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
