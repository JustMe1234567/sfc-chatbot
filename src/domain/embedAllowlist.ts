/**
 * The embed allowlist's domain rules (ticket 76): the owner-managed set of
 * website origins whose pages may host the chatbot widget. Every check here
 * is pure so the public eligibility route, the owner API, the proxy's
 * frame-ancestors decision, and the tests all share one decision.
 */

/** At most twenty exact origins can be allowed at once. */
export const MAX_EMBED_ALLOWLIST_ORIGINS = 20;

/**
 * The origin a genuinely unconfigured installation starts with (ticket 76).
 * It seeds the setting on first boot and is an ordinary removable entry
 * afterwards — once the owner saves, the stored list wins, including a
 * deliberately empty one.
 */
export const DEFAULT_EMBED_ALLOWLIST_ORIGIN = "https://springfieldcollege.ca";

/**
 * The only non-production parent-origin exceptions (ticket 76): fixed,
 * automatic, never stored, never shown as owner-managed entries, and never
 * available as production exceptions. Outside production the widget may be
 * hosted from these origins and the frame may be opened standalone for
 * development testing.
 */
export const DEV_EMBED_PARENT_EXCEPTIONS: readonly string[] = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

export type EmbedOriginError =
  | "invalid_url"
  | "not_https"
  | "credentials"
  | "wildcard_host";

/**
 * Normalizes a pasted page address to its exact origin: every path on the
 * website becomes eligible to host the widget. Requires HTTPS (production
 * websites only — the development exceptions are fixed and never stored),
 * refuses embedded credentials and wildcard hosts, and keeps an explicit
 * non-default port because the origin the browser reports would carry it.
 * Anything else reads as not a website we can allow.
 */
export function normalizeEmbedOrigin(input: string): { ok: true; origin: string } | { ok: false; reason: EmbedOriginError } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "not_https" };
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return { ok: false, reason: "credentials" };
  }
  if (url.hostname.includes("*")) {
    return { ok: false, reason: "wildcard_host" };
  }
  if (url.hostname.length === 0) {
    return { ok: false, reason: "invalid_url" };
  }
  return { ok: true, origin: url.origin };
}

/**
 * Loosens the normalizer for the one job the strict rules can't do: judging
 * the parent origin a host page reports about itself, which may be one of
 * the fixed HTTP development exceptions. Still an exact origin — no
 * credentials, no wildcards, no paths — and still the whole decision input.
 */
export function normalizeCandidateParentOrigin(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return null;
  }
  if (url.hostname.includes("*") || url.hostname.length === 0) {
    return null;
  }
  return url.origin;
}

export type EmbedAllowlistValidation =
  | { ok: true; origins: string[] }
  | { ok: false; error: string };

const REASON_MESSAGES: Record<EmbedOriginError, string> = {
  invalid_url: "is not a valid web address",
  not_https: "must use HTTPS",
  credentials: "cannot contain a username or password",
  wildcard_host: "cannot use a wildcard host",
};

/** Echoes a pasted value in feedback without quoting megabytes of it. */
function quoted(input: string): string {
  const trimmed = input.trim();
  return `"${trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed}"`;
}

/**
 * Validates a whole allowlist write: exact HTTPS origins, no duplicates
 * after normalization, at most twenty. The first problem wins with an
 * actionable message naming the offending entry.
 */
export function validateEmbedAllowlist(input: unknown): EmbedAllowlistValidation {
  if (!Array.isArray(input)) {
    return { ok: false, error: "Provide the allowlist as a list of website addresses." };
  }
  const origins: string[] = [];
  for (const entry of input) {
    if (typeof entry !== "string") {
      return { ok: false, error: "Every entry must be a web address." };
    }
    const normalized = normalizeEmbedOrigin(entry);
    if (!normalized.ok) {
      return {
        ok: false,
        error: `${quoted(entry)} ${REASON_MESSAGES[normalized.reason]}.`,
      };
    }
    if (origins.includes(normalized.origin)) {
      return {
        ok: false,
        error: `${normalized.origin} is already on the allowlist.`,
      };
    }
    origins.push(normalized.origin);
  }
  if (origins.length > MAX_EMBED_ALLOWLIST_ORIGINS) {
    return {
      ok: false,
      error: `A maximum of ${MAX_EMBED_ALLOWLIST_ORIGINS} websites can be allowed.`,
    };
  }
  return { ok: true, origins };
}

/**
 * The eligibility decision: an exact, already-normalized candidate origin
 * against the stored allowlist, with the development exceptions and the
 * trusted application origins available only outside production. Anything
 * unknown is denied — the caller passing a null candidate (malformed,
 * missing, unverifiable) is the deny path.
 */
export function isEmbedOriginAllowed(
  candidateOrigin: string | null,
  storedOrigins: readonly string[],
  extraAllowedOrigins: readonly string[],
  production: boolean,
): boolean {
  if (candidateOrigin === null) {
    return false;
  }
  if (production) {
    return storedOrigins.includes(candidateOrigin);
  }
  return [...storedOrigins, ...extraAllowedOrigins, ...DEV_EMBED_PARENT_EXCEPTIONS].includes(
    candidateOrigin,
  );
}

/**
 * The browser-enforced second layer: the `frame-ancestors` value the widget
 * frame response carries. Production names exactly the stored allowlist —
 * an empty allowlist is 'none', refusing every parent — while outside
 * production the trusted application origins (and therefore the loopback
 * spellings) stay embeddable for development testing.
 */
export function resolveFrameAncestors(
  storedOrigins: readonly string[],
  extraAllowedOrigins: readonly string[],
  production: boolean,
): string {
  const ancestors = production
    ? [...new Set(storedOrigins)]
    : [...new Set([...storedOrigins, ...extraAllowedOrigins])];
  if (ancestors.length === 0) {
    return "frame-ancestors 'none'";
  }
  return `frame-ancestors ${ancestors.join(" ")}`;
}

/**
 * Production standalone use is refused (ticket 76): a top-level navigation
 * to the frame is not an embed, and an absent Sec-Fetch-Dest header (old
 * browsers, bespoke clients) reads as unverifiable and is denied the same
 * way. Outside production the frame stays directly openable for
 * development testing.
 */
export function isStandaloneFrameNavigation(
  secFetchDest: string | null,
  production: boolean,
): boolean {
  if (!production) {
    return false;
  }
  return secFetchDest !== "iframe";
}
