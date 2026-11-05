import type { AnswerRule } from "../domain/types";
import type { Store } from "../domain/types";

/**
 * Initial approved answer content for the first slice. The college will
 * replace this with its own reviewed content before launch; these values are
 * launch configuration, not architecture.
 */
const SEEDED_RULES: AnswerRule[] = [
  {
    id: "admissions-overview",
    topic: "Admissions",
    response:
      "You can apply online through our admissions portal. Undergraduate applications ask for your high school transcript and one reference letter. See the admissions page for the full checklist.",
    link: "https://www.springfieldcollege.edu/admissions",
    phrases: [
      "What are the admission requirements",
      "How do I apply",
      "Admission requirements",
    ],
    keywords: [["admissions", "requirements"], ["apply"]],
    status: "published",
    updatedAt: "2026-10-01T09:00:00.000Z",
    publishedBy: null,
    reviewedAt: "2026-10-01T09:00:00.000Z",
    trashedAt: null,
  },
  {
    id: "fees-overview",
    topic: "Fees",
    response:
      "Tuition for most programs is $3,500 per semester. See the fees page for the current schedule.",
    link: "https://www.springfieldcollege.edu/fees",
    phrases: ["How much are the tuition fees", "Tuition fees", "Fees"],
    keywords: [["fees"], ["tuition"]],
    status: "published",
    updatedAt: "2026-10-01T09:00:00.000Z",
    publishedBy: null,
    reviewedAt: "2026-10-01T09:00:00.000Z",
    trashedAt: null,
  },
  {
    id: "scholarships-overview",
    topic: "Scholarships",
    response:
      "Scholarship details are being reviewed and are not published yet. Ask staff for the current options.",
    phrases: ["Scholarships", "Financial aid", "Bursaries"],
    status: "draft",
    updatedAt: "2026-10-01T09:00:00.000Z",
    publishedBy: null,
    reviewedAt: null,
    trashedAt: null,
  },
];

export async function seedAnswerRules(store: Store): Promise<void> {
  // Insert-if-absent: the dashboard owns rules from the first boot on, so a
  // restart must never overwrite staff edits or unpublishing decisions.
  for (const rule of SEEDED_RULES) {
    if (!(await store.getAnswerRule(rule.id))) {
      await store.upsertAnswerRule({ ...rule });
    }
  }
}
