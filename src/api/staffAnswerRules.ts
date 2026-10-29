import { NextResponse } from "next/server";
import type { AppDatabase } from "../db/appDatabase";
import { requireStaff, sameOriginGuard, type StaffContext } from "@/api/staff";
import { staffName } from "@/api/staffConversations";
import { ANSWER_RULE_ROLES } from "@/auth/server";
import { getChatbotService } from "@/db/service";
import type { AnswerRule } from "@/domain/types";

/** A rule as the answers dashboard renders it, with the publisher's name. */
export interface RuleView extends AnswerRule {
  /** Display name of the publishing staff account, resolved for the dashboard. */
  publishedByName: string | null;
}

export async function rulesWithPublisherNames(
  db: AppDatabase,
  rules: AnswerRule[],
): Promise<RuleView[]> {
  return Promise.all(
    rules.map(async (rule) => ({
      ...rule,
      publishedByName: rule.publishedBy ? await staffName(db, rule.publishedBy) : null,
    })),
  );
}

export type LoadedAnswerRule =
  | { rule: AnswerRule; staff: StaffContext }
  | { response: NextResponse };

/**
 * Loads an answer rule for a staff mutation: same-origin check, session,
 * editor/owner role, and existence all verified — the answer-rule counterpart
 * of loadStaffConversation, shared by revise, publish, and unpublish.
 */
export async function loadAnswerRule(
  request: Request,
  id: string,
): Promise<LoadedAnswerRule> {
  const blocked = sameOriginGuard(request);
  if (blocked) {
    return { response: blocked };
  }
  const guard = await requireStaff(request.headers, { roles: ANSWER_RULE_ROLES });
  if ("response" in guard) {
    return { response: guard.response };
  }
  const { store } = await getChatbotService();
  const rule = await store.getAnswerRule(id);
  if (!rule) {
    return {
      response: NextResponse.json(
        { error: { code: "rule_not_found", message: "Answer rule not found." } },
        { status: 404 },
      ),
    };
  }
  return { rule, staff: guard.staff };
}
