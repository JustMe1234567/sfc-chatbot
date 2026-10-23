import { headers } from "next/headers";
import Link from "next/link";
import { requireStaff } from "@/api/staff";
import { ANSWER_RULE_ROLES } from "@/auth/server";
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
      <header className={styles.shellHeader}>
        <h1>New answer</h1>
        <Link href="/dashboard/answers">Back to answers</Link>
      </header>
      <RuleForm mode="create" initial={{ topic: "", response: "", phrasesText: "", keywordsText: "", link: "" }} />
    </main>
  );
}
