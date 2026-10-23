import { NextResponse } from "next/server";
import { validateAnswerRuleInput } from "@/domain/answerRules";
import { getChatbotService } from "@/db/service";
import { loadAnswerRule, rulesWithPublisherNames } from "@/api/staffAnswerRules";
import type { AnswerRule } from "@/domain/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Revises a rule's content. A revision always returns the rule to draft:
 * published means "this exact content was reviewed", so any change must be
 * re-published before it can answer visitors.
 */
export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const loaded = await loadAnswerRule(request, id);
  if ("response" in loaded) {
    return loaded.response;
  }
  const { rule: existing } = loaded;

  const body = await request.json().catch(() => null);
  const validation = validateAnswerRuleInput(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: { code: validation.code, message: validation.message } },
      { status: 400 },
    );
  }

  // The last review stamp stays visible so the dashboard still shows who
  // approved the content that most recently went live. Revisions are not
  // individually attributed until the audit trail arrives (ticket 08).
  const rule: AnswerRule = {
    id: existing.id,
    ...validation.content,
    status: "draft",
    updatedAt: new Date().toISOString(),
    publishedBy: existing.publishedBy,
    reviewedAt: existing.reviewedAt,
  };
  const { store, db } = await getChatbotService();
  await store.upsertAnswerRule(rule);
  return NextResponse.json(rulesWithPublisherNames(db, [rule])[0]);
}
