"use client";

import { useCallback, useEffect, useState } from "react";
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
 * snapshot and is labelled as one, separate from the period totals.
 */
export default function AnalyticsView({
  role,
  settings,
}: {
  role: string;
  settings: { reportingTimeZone: string; retentionDays: number } | null;
}) {
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [period, setPeriod] = useState<AnalyticsPeriod>("7d");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

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

  const today = report?.days[report.days.length - 1]?.day ?? "";
  const totals = report?.totals;

  return (
    <>
      {role === "owner" && settings ? (
        <AnalyticsSettingsForm initial={settings} onSaved={() => void load(period)} />
      ) : null}

      <div className={styles.periodTabs} role="tablist" aria-label="Reporting period">
        {PERIODS.map((option) => (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={option.key === period}
            disabled={loading}
            className={option.key === period ? styles.periodTabActive : styles.periodTab}
            onClick={() => setPeriod(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>

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
                handed to staff
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
              {dayLabel(report!.earliestDay, "")} are no longer available. Median first staff
              reply time is not reported: transcript cleanup removes the very history it would be
              measured from, so past figures could not stay accurate.
            </p>
            <p className={styles.hint}>
              Visitors are counted by an anonymous random identifier held in the chat widget&apos;s
              storage on the chat system — never by IP address, email, or anything typed in a
              chat. Review the analytics privacy note before production use.
            </p>
            {role !== "owner" ? (
              <p className={styles.hint}>
                Analytics settings (time zone and retention) are managed by the dashboard owner.
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
