import { headers } from "next/headers";
import Link from "next/link";
import { requireStaff } from "@/api/staff";
import { ANSWER_RULE_ROLES } from "@/auth/server";
import DashboardHeader from "../header";
import { getChatbotService } from "@/db/service";
import { getEscalationPhrases, getWelcomeMessage } from "@/settings";
import { rulesWithPublisherNames } from "@/api/staffAnswerRules";
import EscalationPhrasesForm from "./escalation-phrases-form";
import WelcomeForm from "./welcome-form";
import styles from "../dashboard.module.css";

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-GB") : "";
}

/** The answer library: drafts and published rules with their review trail. */
export default async function AnswersPage() {
  const staffHeaders = await headers();
  const guard = await requireStaff(staffHeaders, { roles: ANSWER_RULE_ROLES });
  if ("response" in guard) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>This page requires an authorized editor session.</p>
      </main>
    );
  }

  const { store, db } = await getChatbotService();
  const rules = await rulesWithPublisherNames(db, await store.listAnswerRules());
  const phrases = await getEscalationPhrases(db);
  const welcome = await getWelcomeMessage(db);

  return (
    <main className={styles.shell}>
      <DashboardHeader
        area="answers"
        title="Answers"
        name={guard.staff.name}
        role={guard.staff.role}
      />

      <div className={styles.inbox}>
        <div className={styles.publishBar}>
          <Link className={styles.secondaryButton} href="/dashboard/answers/new">
            New answer
          </Link>
        </div>
      </div>

      {rules.length === 0 ? (
        <p className={styles.empty}>No answer rules yet. Create the first one.</p>
      ) : (
        <div className={styles.inbox}>
          {rules.map((rule) => (
            <Link
              key={rule.id}
              href={`/dashboard/answers/${rule.id}`}
              className={styles.conversationCard}
            >
              <div className={styles.meta}>
                {rule.topic}
                {rule.status === "published" ? (
                  <span className={styles.publishedBadge}>published</span>
                ) : (
                  <span className={styles.draftBadge}>draft</span>
                )}
              </div>
              <div className={styles.preview}>{rule.response.slice(0, 140)}</div>
              <div className={styles.meta}>
                {rule.status === "published" && rule.reviewedAt
                  ? `Published by ${rule.publishedByName ?? "an earlier publisher"} · reviewed ${formatDate(rule.reviewedAt)}`
                  : `Draft · last edited ${formatDate(rule.updatedAt)}`}
              </div>
              <div className={styles.meta}>
                {rule.phrases.length} phrase{rule.phrases.length === 1 ? "" : "s"}
                {rule.keywords?.length
                  ? ` · ${rule.keywords.length} keyword condition${rule.keywords.length === 1 ? "" : "s"}`
                  : ""}
                {rule.link ? " · college page link" : ""}
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className={styles.inbox}>
        <EscalationPhrasesForm initialPhrases={phrases} />
        <WelcomeForm initialText={welcome} />
      </div>
    </main>
  );
}
