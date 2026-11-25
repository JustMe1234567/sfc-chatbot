import { headers } from "next/headers";
import { requireStaff } from "@/api/staff";
import { ANSWER_RULE_ROLES } from "@/auth/server";
import DashboardHeader from "../../header";
import RuleForm from "../rule-form";
import styles from "../../dashboard.module.css";
import type { Metadata } from "next";

/** Route-specific document title (ticket 29). */
export const metadata: Metadata = { title: "New rule" };


export default async function NewAnswerPage() {
  const staffHeaders = await headers();
  const guard = await requireStaff(staffHeaders, { roles: ANSWER_RULE_ROLES });
  if ("response" in guard) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>This page requires an authorized session.</p>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <DashboardHeader area="answers" title="New answer" name={guard.staff.name} role={guard.staff.role} />
      <div id="sfc-content" className={styles.contentArea} tabIndex={-1}>
        <RuleForm mode="create" initial={{ topic: "", response: "", phrasesText: "", keywordsText: "", link: "" }} />
      </div>
    </main>
  );
}
