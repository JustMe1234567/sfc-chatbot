import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireStaff } from "@/api/staff";
import { ANSWER_RULE_ROLES } from "@/auth/server";
import { getChatbotService } from "@/db/service";
import { staffName } from "@/api/staffConversations";
import RuleForm from "../rule-form";
import { ruleToFormValues } from "../rule-values";
import PublishControls from "../publish-controls";
import styles from "../../dashboard.module.css";

interface PageProps {
  params: Promise<{ id: string }>;
}

/** Revise, preview, publish, or unpublish one answer rule. */
export default async function EditAnswerPage({ params }: PageProps) {
  const staffHeaders = await headers();
  const guard = await requireStaff(staffHeaders, { roles: ANSWER_RULE_ROLES });
  if ("response" in guard) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>This page requires an authorized editor session.</p>
      </main>
    );
  }
  const { id } = await params;
  const { store, db } = await getChatbotService();
  const rule = await store.getAnswerRule(id);
  if (!rule) {
    notFound();
  }
  const publisherName = rule.publishedBy ? staffName(db, rule.publishedBy) : null;

  return (
    <main className={styles.shell}>
      <header className={styles.shellHeader}>
        <h1>{rule.topic}</h1>
        <Link href="/dashboard/answers">Back to answers</Link>
      </header>

      <div className={styles.ruleCard}>
        <div className={styles.publishBar}>
          <PublishControls ruleId={rule.id} status={rule.status} />
        </div>
        <p className={styles.hint}>
          {rule.status === "published"
            ? `Published by ${publisherName ?? "an earlier publisher"}${
                rule.reviewedAt ? ` · reviewed ${new Date(rule.reviewedAt).toLocaleString("en-GB")}` : ""
              }`
            : "Not live: drafts never answer visitors."}
          {rule.status === "draft" && rule.reviewedAt
            ? ` · last review ${new Date(rule.reviewedAt).toLocaleString("en-GB")} (${
                publisherName ?? "unknown publisher"
              })`
            : ""}
        </p>
      </div>

      <RuleForm mode="edit" ruleId={rule.id} initial={ruleToFormValues(rule)} />
    </main>
  );
}
