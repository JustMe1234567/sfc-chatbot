import { headers } from "next/headers";
import Link from "next/link";
import { requireStaff } from "@/api/staff";
import { STAFF_ROLES } from "@/auth/server";
import DashboardHeader from "../header";
import type { ContactListRow, ContactSortColumn } from "@/domain/types";
import { getChatbotService } from "@/db/service";
import {
  CONTACTS_PAGE_SIZE,
  CONTACT_SORT_COLUMNS,
  CONTACT_SORT_LABELS,
  contactsListOptions,
  contactsPageLinks,
  resolveContactsPage,
  resolveContactsView,
  defaultContactSortDirection,
} from "./pagination";
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

/**
 * The Visitor contacts list, redesigned per the supplied reference (ticket
 * 74): one visible reference-style heading (the shared header's title is
 * visually hidden on this route alone), a count pill and labeled search
 * field, and a bordered table — Name, Email, Phone, Medium, and Date
 * requested — whose every column sorts through the URL (`sort`/`dir`)
 * alongside the existing `page` and the new `q`. Search is server-side and
 * case-insensitive across name, email, and phone, applied before counting
 * and pagination so the pill and pager describe the whole matching set.
 * Each row is one link to its conversation; phones get stacked labeled
 * cards through the same markup.
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
        <p className={styles.empty}>This page requires an authorized session.</p>
      </main>
    );
  }

  const params = await searchParams;
  const view = resolveContactsView(params);
  const options = contactsListOptions(view);

  const { store } = await getChatbotService();
  // The pill's total and the pager describe the whole matching set: the
  // filtered count is one aggregate, the rows are the page slice only
  // (ticket 50's shape).
  const total = await store.countConversationsWithContactRequest(options);
  const { page, totalPages } = resolveContactsPage(params.page, total);
  const rows: ContactListRow[] = await store.listConversationsWithContactRequest(
    page,
    CONTACTS_PAGE_SIZE,
    options,
  );

  // Every link preserves the current search and sort; only the page moves.
  const viewHref = (overrides: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    const merged = {
      q: view.query || undefined,
      sort: view.sort === "requested" ? undefined : view.sort,
      dir:
        view.direction === defaultContactSortDirection(view.sort) ? undefined : view.direction,
      ...overrides,
    };
    for (const [key, value] of Object.entries(merged)) {
      if (value !== undefined) {
        query.set(key, value);
      }
    }
    const encoded = query.toString();
    return encoded ? `/dashboard/contacts?${encoded}` : "/dashboard/contacts";
  };
  const pageHref = (target: number) => {
    const base = viewHref({});
    return base === "/dashboard/contacts" ? `${base}?page=${target}` : `${base}&page=${target}`;
  };

  /** The sort control's target: the same column toggles direction; a new
      column starts at its default. Either way page 1 (ticket 74). */
  const sortHref = (column: ContactSortColumn) =>
    viewHref({
      sort: column,
      dir:
        view.sort === column
          ? view.direction === "asc"
            ? "desc"
            : "asc"
          : defaultContactSortDirection(column),
      page: undefined,
    });

  /** Sort controls expose the active direction through the column th's
      aria-sort and a chevron icon; inactive columns show a neutral mark. */
  const sortIcon = (column: ContactSortColumn) => {
    const active = view.sort === column;
    const descending = active && view.direction === "desc";
    return (
      <svg
        viewBox="0 0 24 24"
        width={16}
        height={16}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={styles.contactsSortIcon}
        data-inactive={active ? undefined : ""}
      >
        {active ? (
          descending ? (
            <path d="M12 5v14M6 13l6 6 6-6" />
          ) : (
            <path d="M12 19V5M6 11l6-6 6 6" />
          )
        ) : (
          <>
            <path d="M8 10l4-4 4 4" />
            <path d="M8 14l4 4 4-4" />
          </>
        )}
      </svg>
    );
  };

  const pillLabel =
    total === 1
      ? view.query
        ? "1 matching contact"
        : "1 saved contact"
      : view.query
        ? `${total} matching contacts`
        : `${total} saved contacts`;

  return (
    <main className={styles.shell}>
      <DashboardHeader
        area="contacts"
        title="Visitor contacts"
        name={guard.staff.name}
        role={guard.staff.role}
        hideTitle
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

            {/* Two distinct empty states (ticket 74): no saved contacts at
                all versus a search that matched none of them. The pill and
                search stay visible while searching so the query can be
                changed or cleared in place. */}
            {total === 0 && !view.query ? (
              <div className={styles.alertEmpty}>
                <strong>No saved contacts yet</strong>
                <p>
                  An entry appears here once a visitor asks an advisor for help or
                  asks to be contacted by email or phone.
                </p>
              </div>
            ) : (
              <>
                <div className={styles.contactsToolbar}>
                  <span className={styles.contactsPill}>
                    <svg
                      viewBox="0 0 24 24"
                      width={18}
                      height={18}
                      aria-hidden="true"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="9" cy="8.5" r="3" />
                      <path d="M3.5 19c.5-3.5 2.8-5 5.5-5s5 1.5 5.5 5" />
                      <circle cx="17" cy="9.5" r="2.4" />
                      <path d="M16.6 14.3c2.2.4 3.9 1.8 4.3 4.2" />
                    </svg>
                    {pillLabel}
                  </span>
                  <form
                    className={styles.contactsSearch}
                    action="/dashboard/contacts"
                    method="get"
                    role="search"
                  >
                    {view.sort !== "requested" ? (
                      <input type="hidden" name="sort" value={view.sort} />
                    ) : null}
                    {view.direction !== defaultContactSortDirection(view.sort) ? (
                      <input type="hidden" name="dir" value={view.direction} />
                    ) : null}
                    <svg
                      viewBox="0 0 24 24"
                      width={18}
                      height={18}
                      aria-hidden="true"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      className={styles.contactsSearchIcon}
                    >
                      <circle cx="11" cy="11" r="6.5" />
                      <path d="M20 20l-4.2-4.2" />
                    </svg>
                    <input
                      type="search"
                      name="q"
                      defaultValue={view.query}
                      aria-label="Search contacts"
                      placeholder="Search contacts..."
                    />
                    <button type="submit" className={styles.contactsSearchSubmit}>
                      Search
                    </button>
                    {view.query ? (
                      <Link
                        className={styles.contactsSearchClear}
                        href={viewHref({ q: undefined, page: undefined })}
                      >
                        Clear
                      </Link>
                    ) : null}
                  </form>
                </div>

                {rows.length === 0 ? (
                  <div className={styles.alertEmpty}>
                    <strong>No contacts match your search</strong>
                    <p>
                      No saved contact matches “{view.query}”.{" "}
                      <Link href={viewHref({ q: undefined, page: undefined })}>
                        Clear the search
                      </Link>{" "}
                      to see every saved contact.
                    </p>
                  </div>
                ) : (
                  <div className={styles.contactsTableWrap}>
                    <table className={styles.contactsTable}>
                      <thead>
                        <tr>
                          {CONTACT_SORT_COLUMNS.map((column) => {
                            const active = view.sort === column;
                            const activeDirection =
                              active ? view.direction : defaultContactSortDirection(column);
                            return (
                              <th
                                key={column}
                                scope="col"
                                aria-sort={
                                  active
                                    ? activeDirection === "asc"
                                      ? "ascending"
                                      : "descending"
                                    : undefined
                                }
                              >
                                <Link
                                  className={`${styles.contactsSort} ${active ? styles.contactsSortActive : ""}`}
                                  href={sortHref(column)}
                                >
                                  {CONTACT_SORT_LABELS[column]}
                                  {sortIcon(column)}
                                </Link>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(({ conversation, medium, requestedAt }) => (
                          <tr key={conversation.id}>
                            <td data-label="Name">
                              {/* The link is the row's accessible and pointer
                                  target; the CSS stretches it over the row. */}
                              <Link
                                className={styles.contactsRowLink}
                                href={`/dashboard/inbox/${conversation.id}`}
                              >
                                <span className={styles.contactsName}>
                                  {conversation.visitorName ?? "Visitor"}
                                </span>
                              </Link>
                            </td>
                            <td data-label="Email">{conversation.visitorEmail}</td>
                            <td data-label="Phone">{conversation.visitorPhone}</td>
                            <td data-label="Medium">{MEDIUM_LABELS[medium] ?? medium}</td>
                            <td data-label="Date requested">
                              <time dateTime={requestedAt}>
                                {new Date(requestedAt).toLocaleString("en-GB")}
                              </time>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {totalPages > 1 && rows.length > 0 ? (
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
