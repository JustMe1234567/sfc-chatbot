import { headers } from "next/headers";
import Link from "next/link";
import { requireStaff } from "@/api/staff";
import { ANSWER_RULE_ROLES } from "@/auth/server";
import DashboardHeader from "../header";
import { getChatbotService } from "@/db/service";
import { getEscalationPhrases, getHandoffOptions, getWaitingNotice, getWelcomeMessage } from "@/settings";
import { rulesWithPublisherNames } from "@/api/staffAnswerRules";
import AnswersWorkspace from "./answers-workspace";
import styles from "../dashboard.module.css";
import type { Metadata } from "next";

/** Route-specific document title (ticket 29). */
export const metadata: Metadata = { title: "Answers" };


/**
 * The answer library (tickets 55-58): the page shell — heading row with the
 * filled primary New Answer action (plus icon) top-right and a short
 * description — over the workspace's three tabs (Answer Rules, Handoff
 * Phrases, Welcome Message), on one wide aligned content grid inside the
 * dashboard's scrolling column. All data is loaded here once; the
 * workspace's switching, search, status views, expansion, and the lifecycle
 * actions are client-side.
 */
export default async function AnswersPage() {
  const staffHeaders = await headers();
  const guard = await requireStaff(staffHeaders, { roles: ANSWER_RULE_ROLES });
  if ("response" in guard) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>This page requires an authorized session.</p>
      </main>
    );
  }

  const { store, db } = await getChatbotService();
  const rules = await rulesWithPublisherNames(db, await store.listAnswerRules());
  const phrases = await getEscalationPhrases(db);
  const options = await getHandoffOptions(db);
  const welcome = await getWelcomeMessage(db);
  const waitingNotice = await getWaitingNotice(db);

  return (
    <main className={styles.shell}>
      <DashboardHeader
        area="answers"
        title="Answers"
        name={guard.staff.name}
        role={guard.staff.role}
      />

      <div id="sfc-content" className={styles.contentArea} tabIndex={-1}>
        <div className={styles.answersPage}>
          <div className={styles.answersHead}>
            <p className={styles.answersIntro}>
              Draft, publish, and review the answers the chat gives visitors —
              plus the phrases and clickable options that go straight to an
              advisor and the fresh-chat greeting.
            </p>
            <Link className={`${styles.primaryButton} ${styles.answersNew}`} href="/dashboard/answers/new">
              <svg
                viewBox="0 0 24 24"
                width={16}
                height={16}
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              New Answer
            </Link>
          </div>
          <AnswersWorkspace
            rules={rules}
            phrases={phrases}
            options={options}
            welcome={welcome}
            waitingNotice={waitingNotice}
          />
        </div>
      </div>
    </main>
  );
}
