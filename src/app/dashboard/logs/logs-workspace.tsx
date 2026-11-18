"use client";

import { useCallback, useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { LoginEvent } from "@/domain/loginLog";
import ConfirmDialog from "../confirm-dialog";
import PendingButton from "../pending-button";
import styles from "../dashboard.module.css";

const VIEWS = [
  { key: "all", label: "Log in logs" },
  { key: "suspicious", label: "Suspicious logs" },
] as const;

type ViewKey = (typeof VIEWS)[number]["key"];

const OUTCOME_LABELS: Record<LoginEvent["outcome"], string> = {
  success: "Signed in",
  failure: "Failed",
  blocked: "Blocked",
};

const REASON_LABELS: Record<string, string> = {
  unknown_username: "Unknown username",
  disabled_account: "Disabled account",
  invalid_password: "Wrong password",
  ip_blocked: "IP blocked",
};

/**
 * Which pill an outcome wears: successes carry the ticket-66 active green,
 * failures stay neutral, and a blocked attempt — the IP block doing its job
 * — wears the same danger treatment as the suspicious flag.
 */
const OUTCOME_BADGES: Record<LoginEvent["outcome"], string | undefined> = {
  success: styles.publishedBadge,
  failure: styles.draftBadge,
  blocked: styles.badge,
};

type ConfirmKind =
  | { kind: "single"; event: LoginEvent }
  | { kind: "selected" }
  | { kind: "all" };

/**
 * The owner's Logs workspace (ticket 81): both views are fetched up front so
 * switching between the complete log and the flagged subset is instant, and
 * every deletion — one entry, the checkbox selection, or the whole log —
 * runs behind its own confirm dialog. The selection is a set of event ids
 * shared by both views: they are one dataset, two filters.
 */
export default function LogsWorkspace() {
  const [view, setView] = useState<ViewKey>("all");
  const [events, setEvents] = useState<LoginEvent[] | null>(null);
  const [flagged, setFlagged] = useState<LoginEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<ConfirmKind | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const [allResponse, suspiciousResponse] = await Promise.all([
        fetch("/api/staff/logs"),
        fetch("/api/staff/logs?view=suspicious"),
      ]);
      if (!allResponse.ok || !suspiciousResponse.ok) {
        setFailed(true);
        return;
      }
      const all = (await allResponse.json()) as { events: LoginEvent[] };
      const suspicious = (await suspiciousResponse.json()) as { events: LoginEvent[] };
      setEvents(all.events);
      setFlagged(suspicious.events);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** The tabs pattern's keyboard contract (ticket 28), with the analytics
      period switch's arrows-with-wrap and Home/End — the views swap
      client-side, so there is no load to stand down for. */
  function onViewTablistKeyDown(event: ReactKeyboardEvent): void {
    const active = VIEWS.findIndex((option) => option.key === view);
    let next: number | null = null;
    if (event.key === "ArrowRight") {
      next = (active + 1) % VIEWS.length;
    } else if (event.key === "ArrowLeft") {
      next = (active - 1 + VIEWS.length) % VIEWS.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = VIEWS.length - 1;
    }
    if (next === null) {
      return;
    }
    event.preventDefault();
    const option = VIEWS[next];
    if (!option) {
      return;
    }
    setView(option.key);
    document.getElementById(`logs-tab-${option.key}`)?.focus();
  }

  const rows = view === "all" ? (events ?? []) : (flagged ?? []);
  const visibleSelected = rows.filter((event) => selected.has(event.id));
  const allVisibleSelected = rows.length > 0 && visibleSelected.length === rows.length;

  function toggleVisible(): void {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        for (const event of rows) {
          next.delete(event.id);
        }
      } else {
        for (const event of rows) {
          next.add(event.id);
        }
      }
      return next;
    });
  }

  function toggleOne(id: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function confirmDelete(): Promise<void> {
    if (!confirming) {
      return;
    }
    setPending(true);
    setConfirmError("");
    const body =
      confirming.kind === "all" ? { all: true } : { ids: confirming.kind === "single" ? [confirming.event.id] : [...selected] };
    try {
      const response = await fetch("/api/staff/logs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setConfirmError(failure?.error?.message ?? "Could not delete the entries.");
        return;
      }
      const result = (await response.json()) as { removed: number };
      setSelected(new Set());
      setConfirming(null);
      setMessage(
        confirming.kind === "all"
          ? "The log is cleared."
          : result.removed === 1
            ? "Entry deleted."
            : `${result.removed} entries deleted.`,
      );
      await load();
    } catch {
      setConfirmError("Could not delete the entries.");
    } finally {
      setPending(false);
    }
  }

  const confirmCopy = (() => {
    if (!confirming) {
      return null;
    }
    if (confirming.kind === "all") {
      return "Every login event — complete log and suspicious flags — is deleted permanently. This cannot be undone.";
    }
    if (confirming.kind === "selected") {
      return `${selected.size} selected ${selected.size === 1 ? "entry is" : "entries are"} deleted permanently. This cannot be undone.`;
    }
    return `The entry for ${confirming.event.username} at ${new Date(confirming.event.createdAt).toLocaleString("en-GB")} is deleted permanently.`;
  })();

  return (
    <>
      <div className={styles.periodTabs} role="tablist" aria-label="Logs views" onKeyDown={onViewTablistKeyDown}>
        {VIEWS.map((option) => (
          <button
            key={option.key}
            type="button"
            role="tab"
            id={`logs-tab-${option.key}`}
            aria-selected={option.key === view}
            aria-controls="logs-panel"
            tabIndex={option.key === view ? 0 : -1}
            className={option.key === view ? styles.periodTabActive : styles.periodTab}
            onClick={() => setView(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className={styles.logsActions}>
        <PendingButton
          className={styles.secondaryButton}
          pending={false}
          pendingLabel="Deleting…"
          disabled={selected.size === 0 || pending || confirming !== null}
          onClick={() => setConfirming({ kind: "selected" })}
        >
          Delete selected
        </PendingButton>
        <PendingButton
          className={styles.destructiveButton}
          pending={false}
          pendingLabel="Clearing…"
          disabled={pending || confirming !== null}
          onClick={() => setConfirming({ kind: "all" })}
        >
          Clear all
        </PendingButton>
      </div>

      <div role="tabpanel" id="logs-panel" aria-labelledby={`logs-tab-${view}`} tabIndex={0}>
        {failed ? (
          <>
            <p className={styles.error} role="alert">
              The log could not be loaded. Please try again.
            </p>
            <p>
              <button type="button" className={styles.secondaryButton} onClick={() => void load()}>
                Try again
              </button>
            </p>
          </>
        ) : loading ? (
          <p className={styles.hint}>Loading the log…</p>
        ) : rows.length === 0 ? (
          <p className={styles.hint}>
            {view === "all"
              ? "No sign-in attempts have been logged yet."
              : "Nothing has been flagged as suspicious."}
          </p>
        ) : (
          <div className={styles.logsTableWrap}>
            <table className={styles.logsTable}>
              <thead>
                <tr>
                  <th scope="col">
                    <input
                      type="checkbox"
                      className={styles.logsCheck}
                      checked={allVisibleSelected}
                      onChange={toggleVisible}
                      aria-label="Select all entries in this view"
                    />
                  </th>
                  <th scope="col">When</th>
                  <th scope="col">Username</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Reason</th>
                  <th scope="col">IP</th>
                  <th scope="col">User agent</th>
                  <th scope="col">
                    <span className={styles.srOnly}>Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((event) => (
                  <tr key={event.id} className={event.suspicious ? styles.logsRowFlagged : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        className={styles.logsCheck}
                        checked={selected.has(event.id)}
                        onChange={() => toggleOne(event.id)}
                        aria-label={`Select the entry for ${event.username} at ${new Date(event.createdAt).toLocaleString("en-GB")}`}
                      />
                    </td>
                    <td>{new Date(event.createdAt).toLocaleString("en-GB")}</td>
                    <td>{event.username}</td>
                    <td>
                      <span className={OUTCOME_BADGES[event.outcome]}>{OUTCOME_LABELS[event.outcome]}</span>
                      {event.suspicious ? <span className={styles.badge}>Suspicious</span> : null}
                    </td>
                    <td>{event.reason ? (REASON_LABELS[event.reason] ?? event.reason) : "—"}</td>
                    <td>{event.ip}</td>
                    <td className={styles.logsAgent}>{event.userAgent ?? "—"}</td>
                    <td>
                      <PendingButton
                        className={styles.secondaryButton}
                        pending={false}
                        pendingLabel="…"
                        disabled={pending || confirming !== null}
                        onClick={() => setConfirming({ kind: "single", event })}
                        ariaLabel={`Delete the entry for ${event.username} at ${new Date(event.createdAt).toLocaleString("en-GB")}`}
                      >
                        Delete
                      </PendingButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {message ? (
          <p className={styles.hint} role="status">
            {message}
          </p>
        ) : null}
      </div>

      {confirming ? (
        <ConfirmDialog
          title={
            confirming.kind === "all"
              ? "Clear the whole log?"
              : confirming.kind === "selected"
                ? "Delete the selected entries?"
                : "Delete this entry?"
          }
          confirmLabel={confirming.kind === "all" ? "Clear log" : "Delete"}
          pendingLabel="Deleting…"
          pending={pending}
          error={confirmError}
          onConfirm={() => void confirmDelete()}
          onCancel={() => {
            setConfirming(null);
            setConfirmError("");
          }}
        >
          <p>{confirmCopy}</p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
