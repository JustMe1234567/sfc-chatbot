"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  MAX_EMBED_ALLOWLIST_ORIGINS,
  normalizeEmbedOrigin,
  validateEmbedAllowlist,
  type EmbedOriginError,
} from "@/domain/embedAllowlist";
import PendingButton from "../pending-button";
import styles from "../dashboard.module.css";

const REASON_MESSAGES: Record<EmbedOriginError, string> = {
  invalid_url: "Enter the address of a web page, such as https://springfieldcollege.ca/programs.",
  not_https: "Only HTTPS websites can be allowed.",
  credentials: "Addresses containing a username or password cannot be allowed.",
  wildcard_host: "Wildcard hosts cannot be allowed — enter an exact website.",
};

/**
 * The owner-managed embed allowlist (ticket 76): the websites whose pages
 * may host the chatbot widget. A pasted page address normalizes to its
 * origin on add — every path on that website becomes eligible — and each
 * add or removal saves immediately, so newly loaded widgets follow the
 * current list with no redeploy. The Springfield College seed starts as an
 * ordinary removable entry; a deliberately emptied list is a real
 * configuration that stays empty.
 */
export default function EmbedAllowlistSettings({ initialOrigins }: { initialOrigins: string[] }) {
  const router = useRouter();
  const [origins, setOrigins] = useState(initialOrigins);
  const [website, setWebsite] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function save(next: string[]): Promise<boolean> {
    setPending(true);
    setMessage("");
    const response = await fetch("/api/staff/settings/embed-allowlist", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origins: next }),
    });
    setPending(false);
    if (!response.ok) {
      const failure = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setMessage(failure?.error?.message ?? "Could not save the allowlist.");
      return false;
    }
    const result = (await response.json()) as { origins: string[] };
    // The saved state is the server's normalized list, not the optimistic one.
    setOrigins(result.origins);
    setMessage("Allowlist saved. Newly loaded widgets follow it immediately.");
    router.refresh();
    return true;
  }

  async function addWebsite(event: React.FormEvent) {
    event.preventDefault();
    if (pending) {
      return;
    }
    const trimmed = website.trim();
    if (trimmed.length === 0) {
      setMessage("Enter the address of a web page to allow.");
      return;
    }
    // Instant client-side feedback mirrors the server's rules; the save
    // re-validates everything, so the server stays the authority.
    const normalized = normalizeEmbedOrigin(trimmed);
    if (!normalized.ok) {
      setMessage(REASON_MESSAGES[normalized.reason]);
      return;
    }
    if (origins.includes(normalized.origin)) {
      setMessage(`${normalized.origin} is already on the allowlist.`);
      return;
    }
    if (origins.length >= MAX_EMBED_ALLOWLIST_ORIGINS) {
      setMessage(`A maximum of ${MAX_EMBED_ALLOWLIST_ORIGINS} websites can be allowed.`);
      return;
    }
    const saved = await save([...origins, normalized.origin]);
    if (saved) {
      setWebsite("");
    }
  }

  async function remove(origin: string) {
    if (pending) {
      return;
    }
    // Whole-list validation on remove too: the ceiling cannot be violated
    // by a removal, so the filtered list is always a valid write.
    const validated = validateEmbedAllowlist(origins.filter((entry) => entry !== origin));
    if (validated.ok) {
      await save(validated.origins);
    }
  }

  return (
    <form className={styles.ruleCard} onSubmit={addWebsite}>
      <h2>Embed allowlist</h2>
      <p className={styles.hint}>
        The chatbot widget renders only on these websites (up to
        {" "}{MAX_EMBED_ALLOWLIST_ORIGINS}). Pasting any page address allows
        every page on that website — the address is remembered as the
        website&apos;s origin. An empty allowlist keeps the widget off every
        website until a site is added again.
      </p>
      {origins.length > 0 ? (
        <ul className={styles.allowlistList}>
          {origins.map((origin) => (
            <li key={origin} className={styles.allowlistRow}>
              <span className={styles.allowlistOrigin}>{origin}</span>
              <PendingButton
                pending={pending}
                pendingLabel="Saving…"
                disabled={pending}
                onClick={() => void remove(origin)}
                ariaLabel={`Remove ${origin} from the allowlist`}
              >
                Remove
              </PendingButton>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.hint}>No websites are allowed right now.</p>
      )}
      <div className={styles.formField}>
        <label htmlFor="embed-allowlist-website">Add website</label>
        <input
          id="embed-allowlist-website"
          type="text"
          inputMode="url"
          placeholder="https://springfieldcollege.ca/programs/example"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>
      <div className={styles.formActions}>
        <PendingButton type="submit" pending={pending} pendingLabel="Saving…">
          Add website
        </PendingButton>
      </div>
      {message ? (
        <p className={styles.hint} role="status">
          {message}
        </p>
      ) : null}
    </form>
  );
}
