import { headers } from "next/headers";
import { requireStaff } from "@/api/staff";
import { ANSWER_RULE_ROLES } from "@/auth/server";
import DashboardHeader from "../../header";
import RuleForm from "../rule-form";
import styles from "../../dashboard.module.css";

export default async function NewAnswerPage() {
  const staffHeaders = await headers();
  const guard = await requireStaff(staffHeaders, { roles: ANSWER_RULE_ROLES });
  if ("response" in guard) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>This page requires an authorized editor session.</p>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <DashboardHeader area="answers" title="New answer" name={guard.staff.name} role={guard.staff.role} />
      <div className={styles.contentArea}>
        <RuleForm mode="create" initial={{ topic: "", response: "", phrasesText: "", keywordsText: "", link: "" }} />
      </div>
    </main>
  );
}
