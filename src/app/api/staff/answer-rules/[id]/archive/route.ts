import { NextResponse } from "next/server";
import { audit } from "@/api/audit";
import { getChatbotService } from "@/db/service";
import { loadAnswerRule, rulesWithPublisherNames } from "@/api/staffAnswerRules";
import type { AnswerRule } from "@/domain/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Archive (ticket 58): removes the answer from the Published/Draft lists and
 * from visitors immediately — the visitor query reads published rules only,
 * so the status flip alone retires it — while preserving the content in the
 * dashboard's Archived view for later restoration. The last review stamps
 * stay, exactly as unpublishing keeps them.
 */
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const loaded = await loadAnswerRule(request, id);
  if ("response" in loaded) {
    return loaded.response;
  }

  const rule: AnswerRule = {
    ...loaded.rule,
    status: "archived",
    updatedAt: new Date().toISOString(),
    trashedAt: null,
  };
  const { store, db } = await getChatbotService();
  await store.upsertAnswerRule(rule);
  await audit(store, loaded.staff.userId, "rule_archived", { ruleId: rule.id });
  return NextResponse.json((await rulesWithPublisherNames(db, [rule]))[0]);
}
