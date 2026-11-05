"use client";

import { useState, type ReactNode } from "react";
import type { RuleView } from "@/api/staffAnswerRules";
import type { AnswerRuleStatus } from "@/domain/types";
import EscalationPhrasesForm from "./escalation-phrases-form";
import WelcomeForm from "./welcome-form";
import AnswerActions from "./answer-actions";
import styles from "../dashboard.module.css";

/**
 * The Answers tab's interactive workspace (tickets 55-56, lifecycle views
 * from 58): three tabs — Answer Rules (default), Handoff Phrases, Welcome
 * Message — switching in place, with client-side search and a status view
 * over the already-loaded rules, and reference-styled expandable answer
 * cards. The rules arrive as props once; the workspace keeps them in state
 * so the card menu's lifecycle actions (duplicate, publish/unpublish,
 * archive, trash, restore, permanent delete) update the page without a
 * reload. Filtering never touches the network — all mutations ride the
 * AnswerActions component — and the two configuration forms keep their own
 * save flows untouched.
 */

type AnswersTab = "rules" | "phrases" | "welcome";

const TABS: { id: AnswersTab; label: string }[] = [
  { id: "rules", label: "Answer Rules" },
  { id: "phrases", label: "Handoff Phrases" },
  { id: "welcome", label: "Welcome Message" },
];

export type AnswersStatusFilter = "all" | "published" | "draft" | "archived" | "trash";

/** Which rule statuses each filter view shows (ticket 58): "all" — and any
    unknown value, defensively — means the active answers only; Archived and
    Trash are deliberate views of their own. */
const VIEW_STATUSES: Record<AnswersStatusFilter, AnswerRuleStatus[]> = {
  all: ["draft", "published"],
  published: ["published"],
  draft: ["draft"],
  archived: ["archived"],
  trash: ["trashed"],
};

/**
 * The search + view filter (tickets 55-58): case-insensitive text over the
 * topic and the answer content, ANDed with the chosen view, on the
 * already-loaded array — no requests. An archived or trashed answer never
 * appears in the normal list.
 */
export function filterAnswerRules(
  rules: RuleView[],
  query: string,
  status: AnswersStatusFilter = "all",
): RuleView[] {
  const view = VIEW_STATUSES[status] ?? VIEW_STATUSES.all;
  const needle = query.trim().toLowerCase();
  return rules.filter((rule) => {
    if (!view.includes(rule.status)) {
      return false;
    }
    if (!needle) {
      return true;
    }
    return (
      rule.topic.toLowerCase().includes(needle) ||
      rule.response.toLowerCase().includes(needle)
    );
  });
}

export type TopicIconName = "people" | "coins" | "graduation" | "book" | "car" | "document";

/**
 * The card icon tile's topic map (ticket 56): a deterministic keyword sweep
 * over the topic — admissions/visits → people, fees/tuition/payment → coins,
 * scholarships/financial aid → graduation cap, library → book, parking →
 * car — with a document fallback for everything else. Presentation only:
 * first match wins in this fixed order, and the map never touches data.
 */
export function iconForTopic(topic: string): TopicIconName {
  const text = topic.toLowerCase();
  if (text.includes("admission") || text.includes("visit")) {
    return "people";
  }
  if (text.includes("fee") || text.includes("tuition") || text.includes("payment")) {
    return "coins";
  }
  if (text.includes("scholarship") || text.includes("financial aid")) {
    return "graduation";
  }
  if (text.includes("library")) {
    return "book";
  }
  if (text.includes("parking")) {
    return "car";
  }
  return "document";
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-GB") : "";
}

/** The shared stroke-icon wrapper: hand-authored marks on the 24-grid, in
    the sidebar/ticket-52 style — currentColor, no fills, always decorative. */
function Glyph({
  size = 15,
  weight = 1.8,
  className,
  children,
}: {
  size?: number;
  weight?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

function SearchIcon() {
  return (
    <Glyph size={16}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Glyph>
  );
}

function CheckIcon() {
  return (
    <Glyph size={11} weight={2.6}>
      <path d="m4.5 12.5 4.5 4.5L19.5 6.5" />
    </Glyph>
  );
}

function PersonIcon() {
  return (
    <Glyph size={14}>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
    </Glyph>
  );
}

function CalendarIcon() {
  return (
    <Glyph size={14}>
      <rect x="4" y="5.5" width="16" height="15" rx="2.5" />
      <path d="M4 10.5h16M8.5 3v4M15.5 3v4" />
    </Glyph>
  );
}

function BubbleIcon() {
  return (
    <Glyph size={14}>
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-3-.4-4.2-1.1L3.5 20l1.2-4.5A8.5 8.5 0 1 1 21 11.5Z" />
    </Glyph>
  );
}

function FunnelIcon() {
  return (
    <Glyph size={14}>
      <path d="M4 5.5h16l-6.2 7.2v5.4l-3.6 1.6v-7L4 5.5Z" />
    </Glyph>
  );
}

function ChainIcon() {
  return (
    <Glyph size={14}>
      <path d="M10.2 13.8a4.2 4.2 0 0 0 6.3.5l2.5-2.5a4.2 4.2 0 0 0-6-6l-1.4 1.4" />
      <path d="M13.8 10.2a4.2 4.2 0 0 0-6.3-.5l-2.5 2.5a4.2 4.2 0 0 0 6 6l1.4-1.4" />
    </Glyph>
  );
}

function SortGlyph() {
  return (
    <Glyph size={14} weight={1.6}>
      <path d="M9 19V5m0 0L5.5 8.5M9 5l3.5 3.5" />
      <path d="M15 5v14m0 0 3.5-3.5M15 19l-3.5-3.5" />
    </Glyph>
  );
}

const TOPIC_ICONS: Record<TopicIconName, () => ReactNode> = {
  people: () => (
    <Glyph size={24} weight={1.6}>
      <circle cx="9.5" cy="9" r="3" />
      <path d="M4 19.5a5.5 5.5 0 0 1 11 0" />
      <path d="M15.5 6.6a3 3 0 1 1 .6 5.9" />
      <path d="M17.4 14.7a5.5 5.5 0 0 1 2.6 4.8" />
    </Glyph>
  ),
  coins: () => (
    <Glyph size={24} weight={1.6}>
      <ellipse cx="12" cy="6.5" rx="7" ry="3" />
      <path d="M5 6.5V12c0 1.66 3.13 3 7 3s7-1.34 7-3V6.5" />
      <path d="M5 12v5.5c0 1.66 3.13 3 7 3s7-1.34 7-3V12" />
    </Glyph>
  ),
  graduation: () => (
    <Glyph size={24} weight={1.6}>
      <path d="m2.5 9.8 9.5-4.5 9.5 4.5-9.5 4.5-9.5-4.5Z" />
      <path d="M6.5 12v4.2c0 1.32 2.46 2.4 5.5 2.4s5.5-1.08 5.5-2.4V12" />
      <path d="M21.5 9.8v4.7" />
    </Glyph>
  ),
  book: () => (
    <Glyph size={24} weight={1.6}>
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    </Glyph>
  ),
  car: () => (
    <Glyph size={24} weight={1.6}>
      <path d="M4 17v-4.1c0-.9.25-1.76.7-2.5l1.6-2.7a2.5 2.5 0 0 1 2.1-1.2h7.2a2.5 2.5 0 0 1 2.1 1.2l1.6 2.7c.45.74.7 1.6.7 2.5V17" />
      <path d="M4 14h16" />
      <circle cx="7.3" cy="17" r="1.7" />
      <circle cx="16.7" cy="17" r="1.7" />
    </Glyph>
  ),
  document: () => (
    <Glyph size={24} weight={1.6}>
      <path d="M6 3.5h7.5L18 8v12.5H6V3.5Z" />
      <path d="M13.5 3.5V8H18" />
      <path d="M9 12.5h6M9 16h6" />
    </Glyph>
  ),
};

function Chevron() {
  return (
    <Glyph size={16} className={styles.answersChevron}>
      <path d="m6 9 6 6 6-6" />
    </Glyph>
  );
}

function MetaItem({
  pill,
  icon,
  children,
}: {
  pill?: boolean;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className={pill ? `${styles.answersMetaItem} ${styles.answersMetaPill}` : styles.answersMetaItem}>
      {icon}
      {children}
    </span>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The card's status pill: green Published, quiet Draft, and the lifecycle
    views' own honest labels (ticket 58). */
function StatusBadge({ rule }: { rule: RuleView }) {
  if (rule.status === "published") {
    return (
      <span className={styles.publishedBadge}>
        <CheckIcon />
        Published
      </span>
    );
  }
  if (rule.status === "archived") {
    return <span className={styles.archivedBadge}>Archived</span>;
  }
  if (rule.status === "trashed") {
    return <span className={styles.trashedBadge}>Trashed</span>;
  }
  return <span className={styles.draftBadge}>Draft</span>;
}

/** The footer's review trail (ticket 58): the published stamps, or the
    plain last-edited line naming the card's lifecycle state. */
function FootTrail({ rule }: { rule: RuleView }) {
  if (rule.status === "published") {
    return (
      <>
        <MetaItem icon={<PersonIcon />}>
          Published by {rule.publishedByName ?? "an earlier publisher"}
        </MetaItem>
        {rule.reviewedAt ? (
          <MetaItem icon={<CalendarIcon />}>Reviewed {formatDate(rule.reviewedAt)}</MetaItem>
        ) : null}
      </>
    );
  }
  if (rule.status === "archived") {
    return (
      <MetaItem icon={<CalendarIcon />}>
        Archived · last edited {formatDate(rule.updatedAt)}
      </MetaItem>
    );
  }
  if (rule.status === "trashed") {
    return (
      <MetaItem icon={<CalendarIcon />}>
        In Trash · last edited {formatDate(rule.updatedAt)}
      </MetaItem>
    );
  }
  return (
    <MetaItem icon={<CalendarIcon />}>
      Draft · last edited {formatDate(rule.updatedAt)}
    </MetaItem>
  );
}

function CardMetaPills({ rule }: { rule: RuleView }) {
  return (
    <>
      <MetaItem pill icon={<BubbleIcon />}>
        {plural(rule.phrases.length, "phrase")}
      </MetaItem>
      {rule.keywords?.length ? (
        <MetaItem pill icon={<FunnelIcon />}>
          {plural(rule.keywords.length, "keyword condition")}
        </MetaItem>
      ) : null}
      {rule.link ? (
        <MetaItem pill icon={<ChainIcon />}>
          College page link
        </MetaItem>
      ) : null}
    </>
  );
}

function AnswerCard({
  rule,
  open,
  onToggle,
  onUpdated,
  onCreated,
  onRemoved,
}: {
  rule: RuleView;
  open: boolean;
  onToggle: () => void;
  onUpdated: (rule: RuleView) => void;
  onCreated: (rule: RuleView) => void;
  onRemoved: (id: string) => void;
}) {
  const panelId = `answer-panel-${rule.id}`;
  const TileIcon = TOPIC_ICONS[iconForTopic(rule.topic)];
  return (
    <li className={styles.answersCard} data-open={open || undefined}>
      {/* Decorative tile: the topic text beside it carries the meaning. */}
      <span className={styles.answersCardTile} aria-hidden="true">
        <TileIcon />
      </span>
      <div className={styles.answersCardContent}>
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
              <StatusBadge rule={rule} />
            </span>
            <Chevron />
          </span>
          <span className={styles.answersCardPreview}>{rule.response}</span>
          <span className={styles.answersCardMeta}>
            <CardMetaPills rule={rule} />
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
            <div className={styles.answersCardMeta}>
              <CardMetaPills rule={rule} />
            </div>
            <div className={styles.answersCardFoot}>
              <p className={styles.answersCardMeta}>
                <FootTrail rule={rule} />
              </p>
              <AnswerActions
                rule={rule}
                onUpdated={onUpdated}
                onCreated={onCreated}
                onRemoved={onRemoved}
              />
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

/** Newest first — the server's list order (updated_at DESC), mirrored after
    every client-side lifecycle mutation. */
function byRecentFirst(list: RuleView[]): RuleView[] {
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export default function AnswersWorkspace({
  rules: initialRules,
  phrases,
  welcome,
}: {
  rules: RuleView[];
  phrases: string[];
  welcome: string;
}) {
  const [rules, setRules] = useState(initialRules);
  const [tab, setTab] = useState<AnswersTab>("rules");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<AnswersStatusFilter>("all");
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const visible = filterAnswerRules(rules, query, status);
  const toggleExpanded = (id: string) => {
    setExpandedIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };
  const handleUpdated = (next: RuleView) => {
    setRules((current) => byRecentFirst(current.map((rule) => (rule.id === next.id ? next : rule))));
  };
  const handleCreated = (next: RuleView) => {
    setRules((current) => byRecentFirst([next, ...current]));
  };
  const handleRemoved = (id: string) => {
    setRules((current) => current.filter((rule) => rule.id !== id));
  };

  return (
    <div>
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
            <div className={styles.answersToolbar}>
              <div className={styles.answersSearchWrap}>
                <SearchIcon />
                <input
                  type="search"
                  className={styles.answersSearch}
                  placeholder="Search answers…"
                  aria-label="Search answers"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <select
                className={styles.answersStatusFilter}
                aria-label="Filter by status"
                value={status}
                onChange={(event) => setStatus(event.target.value as AnswersStatusFilter)}
              >
                <option value="all">All statuses</option>
                <option value="published">Published</option>
                <option value="draft">Draft</option>
                <option value="archived">Archived</option>
                <option value="trash">Trash</option>
              </select>
            </div>
            <div className={styles.answersCountRow}>
              <p className={styles.answersCount} aria-live="polite">
                {plural(visible.length, "answer")}
              </p>
              <p className={styles.answersSortNote}>
                <SortGlyph /> Sorted by current order
              </p>
            </div>
            {visible.length === 0 ? (
              <p className={styles.empty}>
                {query.trim()
                  ? `No answers match “${query.trim()}”. Try a different word.`
                  : status === "draft"
                    ? "No draft answers yet."
                    : status === "published"
                      ? "No published answers yet."
                      : status === "archived"
                        ? "No archived answers."
                        : status === "trash"
                          ? "Trash is empty."
                          : "No active answers."}
              </p>
            ) : (
              <ol className={styles.answersList}>
                {visible.map((rule) => (
                  <AnswerCard
                    key={rule.id}
                    rule={rule}
                    open={expandedIds.includes(rule.id)}
                    onToggle={() => toggleExpanded(rule.id)}
                    onUpdated={handleUpdated}
                    onCreated={handleCreated}
                    onRemoved={handleRemoved}
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
