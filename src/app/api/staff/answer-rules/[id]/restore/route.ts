import { NextResponse } from "next/server";
import { audit } from "@/api/audit";
import { getChatbotService } from "@/db/service";
import { loadAnswerRule, rulesWithPublisherNames } from "@/api/staffAnswerRules";
import type { AnswerRule } from "@/domain/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Restore (ticket 58): returns an Archived or Trashed answer to the active
 * lists — always as a Draft, never automatically republishing it. Clearing
 * the trashedAt stamp cancels a pending Trash expiry; an editor must
 * explicitly publish before visitors see the answer again.
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
    trashedAt: null,
  };
  const { store, db } = await getChatbotService();
  await store.upsertAnswerRule(rule);
  await audit(store, loaded.staff.userId, "rule_restored", { ruleId: rule.id });
  return NextResponse.json((await rulesWithPublisherNames(db, [rule]))[0]);
}
