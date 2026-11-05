"use client";

import { useState } from "react";
import Link from "next/link";
import type { RuleView } from "@/api/staffAnswerRules";
import EscalationPhrasesForm from "./escalation-phrases-form";
import WelcomeForm from "./welcome-form";
import styles from "../dashboard.module.css";

/**
 * The Answers tab's interactive workspace (ticket 55): three tabs — Answer
 * Rules (default), Handoff Phrases, Welcome Message — switching in place,
 * with client-side search over the already-loaded rules and compact
 * expandable answer cards. All data arrives as props from the server page;
 * switching, filtering, and expanding never touch the network, and the two
 * configuration forms keep their own save flows untouched.
 */

type AnswersTab = "rules" | "phrases" | "welcome";

const TABS: { id: AnswersTab; label: string }[] = [
  { id: "rules", label: "Answer Rules" },
  { id: "phrases", label: "Handoff Phrases" },
  { id: "welcome", label: "Welcome Message" },
];

/**
 * The search filter (ticket 55): case-insensitive over the topic and the
 * answer content, on the already-loaded array — no requests. An empty or
 * blank query matches everything.
 */
export function filterAnswerRules(rules: RuleView[], query: string): RuleView[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return rules;
  }
  return rules.filter(
    (rule) =>
      rule.topic.toLowerCase().includes(needle) ||
      rule.response.toLowerCase().includes(needle),
  );
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-GB") : "";
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={styles.answersChevron}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function AnswerCard({
  rule,
  open,
  onToggle,
}: {
  rule: RuleView;
  open: boolean;
  onToggle: () => void;
}) {
  const panelId = `answer-panel-${rule.id}`;
  return (
    <li className={styles.answersCard} data-open={open || undefined}>
      {/* One toggle per card: keyboard-operable, aria-expanded announces the
          state, and the collapsed body it controls is inert. */}
      <button
        type="button"
        className={styles.answersCardToggle}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <span className={styles.answersCardTop}>
          <span className={styles.answersCardTitle}>
            {rule.topic}
            {rule.status === "published" ? (
              <span className={styles.publishedBadge}>published</span>
            ) : (
              <span className={styles.draftBadge}>draft</span>
            )}
          </span>
          <Chevron />
        </span>
        <span className={styles.answersCardPreview}>{rule.response}</span>
        <span className={styles.answersCardMeta}>
          {rule.phrases.length} phrase{rule.phrases.length === 1 ? "" : "s"}
          {rule.keywords?.length
            ? ` · ${rule.keywords.length} keyword condition${rule.keywords.length === 1 ? "" : "s"}`
            : ""}
          {rule.link ? " · college page link" : ""}
        </span>
      </button>
      <div
        id={panelId}
        className={styles.answersCardReveal}
        data-open={open || undefined}
        inert={!open}
      >
        <div className={styles.answersCardBody}>
          <p className={styles.answersCardResponse}>{rule.response}</p>
          <p className={styles.answersCardMeta}>
            {rule.status === "published" && rule.reviewedAt
              ? `Published by ${rule.publishedByName ?? "an earlier publisher"} · reviewed ${formatDate(rule.reviewedAt)}`
              : `Draft · last edited ${formatDate(rule.updatedAt)}`}
          </p>
          <div className={styles.answersCardActions}>
            <Link className={styles.secondaryButton} href={`/dashboard/answers/${rule.id}`}>
              Edit answer
            </Link>
          </div>
        </div>
      </div>
    </li>
  );
}

export default function AnswersWorkspace({
  rules,
  phrases,
  welcome,
}: {
  rules: RuleView[];
  phrases: string[];
  welcome: string;
}) {
  const [tab, setTab] = useState<AnswersTab>("rules");
  const [query, setQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const visible = filterAnswerRules(rules, query);
  const toggleExpanded = (id: string) => {
    setExpandedIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  return (
    <div className={styles.inbox}>
      <div role="tablist" aria-label="Answers sections" className={styles.answersTabs}>
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`answers-tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls={`answers-panel-${entry.id}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="answers-panel-rules"
        aria-labelledby="answers-tab-rules"
        hidden={tab !== "rules"}
        className={styles.answersPanel}
      >
        {rules.length === 0 ? (
          <p className={styles.empty}>No answer rules yet. Create the first one.</p>
        ) : (
          <>
            <input
              type="search"
              className={styles.answersSearch}
              placeholder="Search by title or content"
              aria-label="Search answers"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {visible.length === 0 ? (
              <p className={styles.empty}>
                No answers match “{query.trim()}”. Try a different word.
              </p>
            ) : (
              <ol className={styles.answersList}>
                {visible.map((rule) => (
                  <AnswerCard
                    key={rule.id}
                    rule={rule}
                    open={expandedIds.includes(rule.id)}
                    onToggle={() => toggleExpanded(rule.id)}
                  />
                ))}
              </ol>
            )}
          </>
        )}
      </div>

      <div
        role="tabpanel"
        id="answers-panel-phrases"
        aria-labelledby="answers-tab-phrases"
        hidden={tab !== "phrases"}
        className={styles.answersPanel}
      >
        <EscalationPhrasesForm initialPhrases={phrases} />
      </div>

      <div
        role="tabpanel"
        id="answers-panel-welcome"
        aria-labelledby="answers-tab-welcome"
        hidden={tab !== "welcome"}
        className={styles.answersPanel}
      >
        <WelcomeForm initialText={welcome} />
      </div>
    </div>
  );
}
