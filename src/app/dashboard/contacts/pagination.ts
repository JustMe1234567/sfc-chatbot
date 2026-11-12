/**
 * Pure Visitor contacts pager math (ticket 69, carried from 53): resolving the requested page
 * from the URL and choosing the numbered links to show — the same
 * URL-driven pattern as the Delivery history's (ticket 50). No database
 * access — the data seam lives in the Store port's contact-request page queries.
 * Ticket 74 adds the search/sort URL resolution beside it.
 */

import type {
  ContactListOptions,
  ContactSortColumn,
  ContactSortDirection,
} from "@/domain/types";

/** Rows shown per Visitor contacts page (ticket 69). */
export const CONTACTS_PAGE_SIZE = 10;

/** The displayed columns, in table order (ticket 74). */
export const CONTACT_SORT_COLUMNS: ContactSortColumn[] = [
  "name",
  "email",
  "phone",
  "medium",
  "requested",
];

/** The column labels as the sort controls and card labels show them. */
export const CONTACT_SORT_LABELS: Record<ContactSortColumn, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  medium: "Medium",
  requested: "Date requested",
};

/** "Selecting Name, Email, Phone, or Medium begins ascending; selecting
 * Date requested begins descending" (ticket 74). */
export function defaultContactSortDirection(sort: ContactSortColumn): ContactSortDirection {
  return sort === "requested" ? "desc" : "asc";
}

/**
 * Resolves the view state a contacts URL asks for (ticket 74). Everything
 * invalid falls back without error: an unknown sort column or direction to
 * that column's default, and the query to its trimmed form (an empty or
 * whitespace-only query means no search).
 */
export function resolveContactsView(searchParams: {
  q?: string | string[];
  sort?: string | string[] | undefined;
  dir?: string | string[] | undefined;
}): { query: string; sort: ContactSortColumn; direction: ContactSortDirection } {
  const first = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;
  const query = (first(searchParams.q) ?? "").trim();
  const rawSort = first(searchParams.sort);
  const sort = CONTACT_SORT_COLUMNS.includes(rawSort as ContactSortColumn)
    ? (rawSort as ContactSortColumn)
    : "requested";
  const rawDirection = first(searchParams.dir);
  const direction =
    rawDirection === "asc" || rawDirection === "desc"
      ? rawDirection
      : defaultContactSortDirection(sort);
  return { query, sort, direction };
}

/** The Store options for a resolved view: only a non-empty query searches. */
export function contactsListOptions(view: {
  query: string;
  sort: ContactSortColumn;
  direction: ContactSortDirection;
}): ContactListOptions {
  return {
    ...(view.query ? { query: view.query } : {}),
    sort: view.sort,
    direction: view.direction,
  };
}

/** A short list shows every page; a long one windows around the current. */
const PAGER_WINDOW_MAX_PAGES = 7;

/** One entry in the pager: a page link or the ellipsis between windows. */
export type ContactPageLink = { kind: "page"; page: number } | { kind: "gap" };

/**
 * The page a Visitor contacts URL asks for. Anything non-numeric (digits
 * only — no hex, exponents, or decimals), below 1, or past the last page
 * falls back to page 1, so a stale or hand-edited query string can never
 * error or blank the list.
 */
export function resolveContactsPage(
  raw: string | string[] | undefined,
  total: number,
): { page: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(total / CONTACTS_PAGE_SIZE));
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : 0;
  const page = parsed >= 1 && parsed <= totalPages ? parsed : 1;
  return { page, totalPages };
}

/**
 * The numbered pager links for a page position: every page while the list is
 * short; otherwise the first and last page plus the pages around the current
 * one, with gaps wherever the shown numbers skip.
 */
export function contactsPageLinks(page: number, totalPages: number): ContactPageLink[] {
  if (totalPages <= PAGER_WINDOW_MAX_PAGES) {
    return Array.from({ length: totalPages }, (_, index) => ({
      kind: "page" as const,
      page: index + 1,
    }));
  }
  const wanted = new Set([1, totalPages, page - 1, page, page + 1]);
  const pages = [...wanted].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const links: ContactPageLink[] = [];
  let previous = 0;
  for (const p of pages) {
    if (p - previous >= 2) {
      links.push({ kind: "gap" });
    }
    links.push({ kind: "page", page: p });
    previous = p;
  }
  return links;
}
