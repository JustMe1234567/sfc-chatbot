import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requireStaff } from "@/api/staff";
import { ANSWER_RULE_ROLES } from "@/auth/server";
import DashboardHeader from "../../header";
import { auditWithNames, type AuditView } from "@/api/audit";
import { getChatbotService } from "@/db/service";
import { staffName } from "@/api/staffConversations";
import RuleForm from "../rule-form";
import { ruleToFormValues } from "../rule-values";
import PublishControls from "../publish-controls";
import styles from "../../dashboard.module.css";

interface PageProps {
  params: Promise<{ id: string }>;
}

const RULE_ACTION_LABELS: Partial<Record<AuditView["action"], string>> = {
  rule_created: "created this rule",
  rule_revised: "revised the content",
  rule_published: "published it",
  rule_unpublished: "unpublished it",
};

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
  const ruleAudit = auditWithNames(db, await store.listRuleAudit(rule.id));

  return (
    <main className={styles.shell}>
      <DashboardHeader area="answers" title={rule.topic} name={guard.staff.name} role={guard.staff.role} />

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

      {ruleAudit.length > 0 ? (
        <section aria-label="Rule audit trail" className={styles.inbox}>
          <h2>Activity</h2>
          {ruleAudit.map((entry) => (
            <div key={entry.id} className={styles.conversationCard}>
              <div className={styles.meta}>
                {new Date(entry.createdAt).toLocaleString("en-GB")}
              </div>
              <div className={styles.preview}>
                {entry.actorName ?? "a former staff member"}{" "}
                {RULE_ACTION_LABELS[entry.action] ?? entry.action}
              </div>
            </div>
          ))}
        </section>
      ) : null}
    </main>
  );
}
