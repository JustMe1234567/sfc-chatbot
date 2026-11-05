import { headers } from "next/headers";
import Link from "next/link";
import { requireStaff } from "@/api/staff";
import { ANSWER_RULE_ROLES } from "@/auth/server";
import DashboardHeader from "../header";
import { getChatbotService } from "@/db/service";
import { getEscalationPhrases, getWelcomeMessage } from "@/settings";
import { rulesWithPublisherNames } from "@/api/staffAnswerRules";
import AnswersWorkspace from "./answers-workspace";
import styles from "../dashboard.module.css";

/**
 * The answer library (ticket 55): the page shell — heading row with the
 * New answer action top-right and a short description — over the workspace's
 * three tabs (Answer Rules, Handoff Phrases, Welcome Message). All data is
 * loaded here once; the workspace's switching, search, and expansion are
 * client-side only.
 */
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
        <div className={styles.answersHead}>
          <p className={styles.answersIntro}>
            Draft, publish, and review the answers the chat gives visitors —
            plus the phrases that go straight to staff and the fresh-chat
            greeting.
          </p>
          <Link className={styles.secondaryButton} href="/dashboard/answers/new">
            New answer
          </Link>
        </div>
        <AnswersWorkspace rules={rules} phrases={phrases} welcome={welcome} />
      </div>
    </main>
  );
}
