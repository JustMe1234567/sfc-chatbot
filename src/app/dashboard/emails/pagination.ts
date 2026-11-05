/**
 * Pure Visitor emails pager math (ticket 53): resolving the requested page
 * from the URL and choosing the numbered links to show — the same
 * URL-driven pattern as the Delivery history's (ticket 50). No database
 * access — the data seam lives in the Store port's email page queries.
 */

/** Rows shown per Visitor emails page (ticket 53). */
export const EMAILS_PAGE_SIZE = 10;

/** A short list shows every page; a long one windows around the current. */
const PAGER_WINDOW_MAX_PAGES = 7;

/** One entry in the pager: a page link or the ellipsis between windows. */
export type EmailPageLink = { kind: "page"; page: number } | { kind: "gap" };

/**
 * The page a Visitor emails URL asks for. Anything non-numeric (digits
 * only — no hex, exponents, or decimals), below 1, or past the last page
 * falls back to page 1, so a stale or hand-edited query string can never
 * error or blank the list.
 */
export function resolveEmailsPage(
  raw: string | string[] | undefined,
  total: number,
): { page: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(total / EMAILS_PAGE_SIZE));
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
export function emailsPageLinks(page: number, totalPages: number): EmailPageLink[] {
  if (totalPages <= PAGER_WINDOW_MAX_PAGES) {
    return Array.from({ length: totalPages }, (_, index) => ({
      kind: "page" as const,
      page: index + 1,
    }));
  }
  const wanted = new Set([1, totalPages, page - 1, page, page + 1]);
  const pages = [...wanted].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const links: EmailPageLink[] = [];
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
