import { NextResponse } from "next/server";
import { audit } from "@/api/audit";
import { getChatbotService } from "@/db/service";
import { loadAnswerRule, rulesWithPublisherNames } from "@/api/staffAnswerRules";
import type { AnswerRule } from "@/domain/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Delete (ticket 58): the menu's Delete never destroys anything — it moves
 * the answer to Trash. The trashedAt stamp starts the fixed 30-day purge
 * clock the maintenance sweep runs on; until that threshold the answer can
 * still be restored (always as a Draft). Trashed answers answer no visitors:
 * the visitor query reads published rules only. Conversation transcripts and
 * audit records are untouched.
 */
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const loaded = await loadAnswerRule(request, id);
  if ("response" in loaded) {
    return loaded.response;
  }

  const rule: AnswerRule = {
    ...loaded.rule,
    status: "trashed",
    updatedAt: new Date().toISOString(),
    trashedAt: new Date().toISOString(),
  };
  const { store, db } = await getChatbotService();
  await store.upsertAnswerRule(rule);
  await audit(store, loaded.staff.userId, "rule_trashed", { ruleId: rule.id });
  return NextResponse.json((await rulesWithPublisherNames(db, [rule]))[0]);
}
