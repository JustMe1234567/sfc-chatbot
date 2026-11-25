"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { AnalyticsPeriod, AnalyticsReport } from "@/domain/analytics";
import AnalyticsSettingsForm from "./analytics-settings-form";
import styles from "../dashboard.module.css";

const PERIODS: { key: AnalyticsPeriod; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
];

const NUMBER_FORMAT = new Intl.NumberFormat("en-GB");

/** '2026-10-28' read as a plain calendar date, in a short weekday form. */
function dayLabel(day: string, today: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  const label = date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return day === today ? `${label} (today)` : label;
}

/**
 * The analytics reading view (ticket 17): four counters, a reporting-period
 * switch, and the daily table — every number fetched from the server so the
 * browser only ever sees aggregates. The live-visitor card is a current
 * snapshot and is labelled as one, separate from the period totals. Admins
 * alone reach this page (ticket 102), so the settings form renders whenever
 * the page could load its values.
 */
export default function AnalyticsView({
  settings,
}: {
  settings: { reportingTimeZone: string; retentionDays: number };
}) {
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [period, setPeriod] = useState<AnalyticsPeriod>("7d");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  /**
   * Arrow-driven selections restore focus once the load settles (ticket 28):
   * the load-time `disabled` on the tabs blurs the focused one, and without
   * this flag a keyboard user would land on <body> after every period
   * change. Arrow paths set it; mount and click paths never do, so page
   * load steals no focus.
   */
  const keyboardFocusRef = useRef(false);

  const load = useCallback(async (next: AnalyticsPeriod) => {
    setLoading(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/staff/analytics?period=${next}`);
      if (!response.ok) {
        setFailed(true);
        return;
      }
      setReport((await response.json()) as AnalyticsReport);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period]);

  // The arrow path's focus restoration (ticket 28): the tabs' load-time
  // `disabled` blurs the focused one, so once the report load settles and
  // the tabs re-enable, the selected tab takes focus back. The dependency
  // is loading alone: keying on period as well would re-run this on the
  // selection commit — where loading still reads false — focusing the new
  // tab a beat before the disable blurs it again.
  useEffect(() => {
    if (!loading && keyboardFocusRef.current) {
      keyboardFocusRef.current = false;
      document.getElementById(`analytics-tab-${period}`)?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  /**
   * The tabs pattern's keyboard contract (ticket 28): the switch already
   * promised tab semantics, so arrows move both selection and focus (with
   * wrap), Home/End jump to the ends, and the roving tabindex keeps the
   * tablist a single Tab stop. Arrows stand down while a report load is
   * running — the same stand-down the disabled tabs signal — so a burst of
   * keystrokes cannot stack fetches.
   */
  function onPeriodTablistKeyDown(event: ReactKeyboardEvent): void {
    if (loading) {
      return;
    }
    const active = PERIODS.findIndex((option) => option.key === period);
    let next: number | null = null;
    if (event.key === "ArrowRight") {
      next = (active + 1) % PERIODS.length;
    } else if (event.key === "ArrowLeft") {
      next = (active - 1 + PERIODS.length) % PERIODS.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = PERIODS.length - 1;
    }
    if (next === null) {
      return;
    }
    event.preventDefault();
    keyboardFocusRef.current = true;
    const option = PERIODS[next];
    if (!option) {
      return;
    }
    setPeriod(option.key);
  }

  const today = report?.days[report.days.length - 1]?.day ?? "";
  const totals = report?.totals;

  return (
    <>
      {settings ? (
        <AnalyticsSettingsForm initial={settings} onSaved={() => void load(period)} />
      ) : null}

      <div
        className={styles.periodTabs}
        role="tablist"
        aria-label="Reporting period"
        onKeyDown={onPeriodTablistKeyDown}
      >
        {PERIODS.map((option) => (
          <button
            key={option.key}
            type="button"
            role="tab"
            id={`analytics-tab-${option.key}`}
            aria-selected={option.key === period}
            aria-controls="analytics-panel"
            tabIndex={option.key === period ? 0 : -1}
            disabled={loading}
            className={option.key === period ? styles.periodTabActive : styles.periodTab}
            onClick={() => setPeriod(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* The period tabs' single panel (ticket 28): named by the active tab
          and always rendered so the tabs' aria-controls never dangles; its
          content is whichever period's report is loaded. Focusable so Tab
          leaves the tablist at the report instead of skipping it. */}
      <div
        role="tabpanel"
        id="analytics-panel"
        aria-labelledby={`analytics-tab-${period}`}
        tabIndex={0}
      >
        {failed ? (
          <>
            <p className={styles.error} role="alert">
              The report could not be loaded. Please try again.
            </p>
            <p>
              <button type="button" className={styles.secondaryButton} onClick={() => void load(period)}>
                Try again
              </button>
            </p>
          </>
        ) : null}

        {totals ? (
          <>
            <div className={styles.statGrid}>
              <div className={styles.statCard}>
                <span className={styles.statLabel}>Live visitors</span>
                <span className={styles.statValue} aria-live="polite">
                  {NUMBER_FORMAT.format(totals.liveVisitors)}
                </span>
                <span className={styles.statNote}>
                  on the site now — a snapshot, separate from the period totals
                </span>
              </div>
              <div className={styles.statCard}>
                <span className={styles.statLabel}>Total visitors</span>
                <span className={styles.statValue}>{NUMBER_FORMAT.format(totals.visitors)}</span>
                <span className={styles.statNote}>distinct browsers seen in the period</span>
              </div>
              <div className={styles.statCard}>
                <span className={styles.statLabel}>Total chats</span>
                <span className={styles.statValue}>{NUMBER_FORMAT.format(totals.chats)}</span>
                <span className={styles.statNote}>conversations started in the period</span>
              </div>
              <div className={styles.statCard}>
                <span className={styles.statLabel}>Chats escalated</span>
                <span className={styles.statValue}>{NUMBER_FORMAT.format(totals.escalations)}</span>
                <span className={styles.statNote}>
                  handed to an advisor
                  {totals.chats > 0
                    ? ` · ${Math.round((totals.escalations / totals.chats) * 100)}% of chats`
                    : ""}
                </span>
              </div>
            </div>

            {totals.chats === 0 && totals.visitors === 0 && totals.escalations === 0 ? (
              <p className={styles.empty}>No visitors or chats have been counted in this period yet.</p>
            ) : null}

            <div className={styles.inbox}>
              <table className={styles.analyticsTable}>
                <caption className={styles.srOnly}>
                  Daily visitors, chats started, and escalations ({report!.timeZone})
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Day</th>
                    <th scope="col">Visitors</th>
                    <th scope="col">Chats started</th>
                    <th scope="col">Escalations</th>
                  </tr>
                </thead>
                <tbody>
                  {report!.days.map((row) => (
                    <tr key={row.day}>
                      <th scope="row">{dayLabel(row.day, today)}</th>
                      <td>{NUMBER_FORMAT.format(row.visitors)}</td>
                      <td>{NUMBER_FORMAT.format(row.chats)}</td>
                      <td>{NUMBER_FORMAT.format(row.escalations)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.hintBlock}>
              <p className={styles.hint}>
                Days run in the {report!.timeZone} time zone. Browser counts are estimates: one
                person across devices, or after clearing their browser storage, can be counted more
                than once, and content blockers can prevent counting entirely.
              </p>
              <p className={styles.hint}>
                Visitor analytics is kept for {report!.retentionDays} day
                {report!.retentionDays === 1 ? "" : "s"} — days before{" "}
                {dayLabel(report!.earliestDay, "")} are no longer available. Median first advisor
                reply time is not reported: transcript cleanup removes the very history it would be
                measured from, so past figures could not stay accurate.
              </p>
              <p className={styles.hint}>
                Visitors are counted by an anonymous random identifier held in the chat widget&apos;s
                storage on the chat system — never by IP address, email, or anything typed in a
                chat. Review the analytics privacy note before production use.
              </p>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
