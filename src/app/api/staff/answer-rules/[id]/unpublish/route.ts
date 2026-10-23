import { NextResponse } from "next/server";
import { audit } from "@/api/audit";
import { getChatbotService } from "@/db/service";
import { loadAnswerRule, rulesWithPublisherNames } from "@/api/staffAnswerRules";
import type { AnswerRule } from "@/domain/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Removes a rule from the visitor experience while keeping its content and
 * last review stamp for the dashboard. Like publishing, it is live on the
 * next visitor question with no redeploy. Unpublishing is not attributed to
 * a staff account until the audit trail arrives (ticket 08).
 */
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const loaded = await loadAnswerRule(request, id);
  if ("response" in loaded) {
    return loaded.response;
  }

  const rule: AnswerRule = {
    ...loaded.rule,
    status: "draft",
    updatedAt: new Date().toISOString(),
  };
  const { store, db } = await getChatbotService();
  await store.upsertAnswerRule(rule);
  await audit(store, loaded.staff.userId, "rule_unpublished", { ruleId: rule.id });
  return NextResponse.json(rulesWithPublisherNames(db, [rule])[0]);
}
